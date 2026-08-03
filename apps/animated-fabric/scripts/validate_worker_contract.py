"""Validate the Animated Fabric worker registry against resolved root Compose JSON."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = APP_ROOT.parents[1]
DEFAULT_CONTRACT_PATH = APP_ROOT / "containers" / "worker-contract.json"
DEFAULT_COMPOSE_AUTHORITY = REPOSITORY_ROOT / "compose.yaml"
MAX_CONTRACT_BYTES = 256 * 1024
MAX_COMPOSE_CONFIG_BYTES = 2 * 1024 * 1024
_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:/")


class WorkerContractError(ValueError):
    """One invalid or inconsistent worker-delivery contract."""


def _object(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise WorkerContractError(f"{context} must be a JSON object with string keys.")
    return value


def _string(value: object, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise WorkerContractError(f"{context} must be a non-empty string.")
    return value


def _string_list(value: object, context: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise WorkerContractError(f"{context} must be an array of strings.")
    return tuple(value)


def load_json_document(path: Path, *, maximum_bytes: int) -> dict[str, object]:
    """Load one bounded, regular, duplicate-key-free JSON object."""
    if path.is_symlink():
        raise WorkerContractError(f"{path} must not be a symbolic link.")
    try:
        stat = path.stat()
    except OSError as error:
        raise WorkerContractError(f"Unable to inspect {path}.") from error
    if not path.is_file() or stat.st_size > maximum_bytes:
        raise WorkerContractError(f"{path} is not a bounded regular file.")

    def strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise WorkerContractError(f"{path} contains duplicate JSON key {key!r}.")
            result[key] = value
        return result

    try:
        document: object = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=strict_object,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise WorkerContractError(f"Unable to read valid JSON from {path}.") from error
    return _object(document, str(path))


def _normalized_host_path(value: str) -> str:
    normalized = value.replace("\\", "/").rstrip("/")
    if _WINDOWS_DRIVE.match(normalized):
        return normalized.casefold()
    return normalized


def _joined_host_path(root: str, relative: str) -> str:
    trimmed_root = root.rstrip("/\\")
    return _normalized_host_path(f"{trimmed_root}/{relative}")


def _is_same_or_ancestor(candidate: str, target: str) -> bool:
    if not candidate or candidate == ".":
        return True
    return target == candidate or target.startswith(f"{candidate}/")


def _assert_exact_keys(value: Mapping[str, object], expected: set[str], context: str) -> None:
    if set(value) != expected:
        raise WorkerContractError(f"{context} has unexpected or missing fields.")


def _validate_contract_header(
    contract: Mapping[str, object],
    *,
    expected_source_authority: str,
    expected_compose_authority: str,
) -> tuple[str, str, dict[str, object], dict[str, object]]:
    _assert_exact_keys(
        contract,
        {
            "schema_name",
            "schema_version",
            "compose_project",
            "compose_authority",
            "source_authority",
            "interactive_development_service",
            "workers",
            "worker_invariants",
        },
        "worker contract",
    )
    if contract.get("schema_name") != "animated-fabric-worker-contract":
        raise WorkerContractError("Worker contract schema_name is invalid.")
    if contract.get("schema_version") != 1:
        raise WorkerContractError("Worker contract schema_version is invalid.")
    if contract.get("source_authority") != expected_source_authority:
        raise WorkerContractError("Worker contract source_authority is not canonical.")
    if contract.get("compose_authority") != expected_compose_authority:
        raise WorkerContractError("Worker contract compose_authority is not canonical.")

    project = _string(contract.get("compose_project"), "compose_project")
    development_service = _string(
        contract.get("interactive_development_service"),
        "interactive_development_service",
    )
    workers = _object(contract.get("workers"), "workers")
    invariants = _object(contract.get("worker_invariants"), "worker_invariants")
    if not workers:
        raise WorkerContractError("Worker contract must declare at least one worker.")
    _assert_exact_keys(
        invariants,
        {
            "interactive",
            "source_authority",
            "runtime_network",
            "read_only_root",
            "drop_all_capabilities",
            "no_new_privileges",
        },
        "worker_invariants",
    )
    expected_invariants: dict[str, object] = {
        "interactive": False,
        "source_authority": False,
        "runtime_network": "none",
        "read_only_root": True,
        "drop_all_capabilities": True,
        "no_new_privileges": True,
    }
    if invariants != expected_invariants:
        raise WorkerContractError("Worker contract invariants are weaker than required.")
    return project, development_service, workers, invariants


def _service_bind_mounts(
    service: Mapping[str, object], context: str
) -> tuple[dict[str, object], ...]:
    raw_volumes = service.get("volumes", [])
    if not isinstance(raw_volumes, list):
        raise WorkerContractError(f"{context}.volumes must be an array.")
    volumes: list[dict[str, object]] = []
    for index, raw_volume in enumerate(raw_volumes):
        volume = _object(raw_volume, f"{context}.volumes[{index}]")
        if volume.get("type") == "bind":
            volumes.append(volume)
    return tuple(volumes)


def _assert_development_source_mount(
    service: Mapping[str, object], *, host_repository_root: str, context: str
) -> None:
    repository_root = _normalized_host_path(host_repository_root)
    matching = []
    for volume in _service_bind_mounts(service, context):
        source = _normalized_host_path(_string(volume.get("source"), f"{context} bind source"))
        target = _string(volume.get("target"), f"{context} bind target")
        if source == repository_root and target == "/workspace":
            matching.append(volume)
    if len(matching) != 1:
        raise WorkerContractError(
            "The declared development service must mount the canonical repository once at "
            "/workspace."
        )


def _assert_worker_service(
    worker_id: str,
    worker: Mapping[str, object],
    service: Mapping[str, object],
    *,
    source_root: str,
    repository_root: str,
) -> str:
    _assert_exact_keys(worker, {"service", "image", "profile"}, f"workers.{worker_id}")
    service_name = _string(worker.get("service"), f"workers.{worker_id}.service")
    expected_image = _string(worker.get("image"), f"workers.{worker_id}.image")
    expected_profile = _string(worker.get("profile"), f"workers.{worker_id}.profile")
    context = f"services.{service_name}"

    if service.get("image") != expected_image:
        raise WorkerContractError(f"{context}.image disagrees with the worker contract.")
    if _string_list(service.get("profiles"), f"{context}.profiles") != (expected_profile,):
        raise WorkerContractError(f"{context}.profiles disagrees with the worker contract.")
    if service.get("network_mode") != "none":
        raise WorkerContractError(f"{context} must use network_mode none.")
    if service.get("read_only") is not True:
        raise WorkerContractError(f"{context} must use a read-only root filesystem.")
    if set(_string_list(service.get("cap_drop"), f"{context}.cap_drop")) != {"ALL"}:
        raise WorkerContractError(f"{context} must drop all Linux capabilities.")
    security_options = set(_string_list(service.get("security_opt"), f"{context}.security_opt"))
    if "no-new-privileges:true" not in security_options:
        raise WorkerContractError(f"{context} must prevent new privileges.")
    if service.get("stdin_open") is True or service.get("tty") is True:
        raise WorkerContractError(f"{context} must not be interactive.")
    if service.get("ports") or service.get("expose"):
        raise WorkerContractError(f"{context} must not expose a network endpoint.")

    build = _object(service.get("build"), f"{context}.build")
    build_context = _normalized_host_path(_string(build.get("context"), f"{context}.build.context"))
    if build_context != source_root:
        raise WorkerContractError(f"{context} must build from the canonical source authority.")

    for volume in _service_bind_mounts(service, context):
        source = _normalized_host_path(_string(volume.get("source"), f"{context} bind source"))
        target = _string(volume.get("target"), f"{context} bind target")
        if (
            _is_same_or_ancestor(source, repository_root)
            or _is_same_or_ancestor(source, source_root)
            or target == "/workspace"
        ):
            raise WorkerContractError(f"{context} must not mount a source-authority root.")
        if source.endswith("/docker.sock") or target.endswith("/docker.sock"):
            raise WorkerContractError(f"{context} must not mount a Docker socket.")
    return service_name


def validate_worker_contract(
    contract: Mapping[str, object],
    compose_config: Mapping[str, object],
    *,
    host_repository_root: str,
    expected_source_authority: str,
    expected_compose_authority: str,
) -> tuple[str, ...]:
    """Validate every registered worker against one resolved Compose document."""
    project, development_service_name, workers, _ = _validate_contract_header(
        contract,
        expected_source_authority=expected_source_authority,
        expected_compose_authority=expected_compose_authority,
    )
    if compose_config.get("name") != project:
        raise WorkerContractError("Resolved Compose project name disagrees with the contract.")
    services = _object(compose_config.get("services"), "resolved Compose services")
    development_service = _object(
        services.get(development_service_name),
        f"services.{development_service_name}",
    )
    _assert_development_source_mount(
        development_service,
        host_repository_root=host_repository_root,
        context=f"services.{development_service_name}",
    )

    repository_root = _normalized_host_path(host_repository_root)
    source_root = _joined_host_path(host_repository_root, expected_source_authority)
    validated_services: list[str] = []
    seen_services: set[str] = set()
    for worker_id in sorted(workers):
        worker = _object(workers[worker_id], f"workers.{worker_id}")
        service_name = _string(worker.get("service"), f"workers.{worker_id}.service")
        if service_name in seen_services:
            raise WorkerContractError("Each worker must own a distinct Compose service.")
        service = _object(services.get(service_name), f"services.{service_name}")
        validated_services.append(
            _assert_worker_service(
                worker_id,
                worker,
                service,
                source_root=source_root,
                repository_root=repository_root,
            )
        )
        seen_services.add(service_name)

    return tuple(validated_services)


def build_parser() -> argparse.ArgumentParser:
    """Build the worker-contract validation parser."""
    parser = argparse.ArgumentParser(
        description="Validate Animated Fabric worker metadata against resolved root Compose JSON."
    )
    parser.add_argument(
        "--compose-config",
        required=True,
        type=Path,
        help="JSON emitted by docker compose config --format json.",
    )
    parser.add_argument(
        "--host-repository-root",
        required=True,
        help="Host path used to resolve bind mounts and build contexts.",
    )
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT_PATH)
    parser.add_argument("--compose-authority", type=Path, default=DEFAULT_COMPOSE_AUTHORITY)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Validate the resolved worker boundary and return a shell-compatible status."""
    arguments = build_parser().parse_args(argv)
    try:
        contract = load_json_document(arguments.contract, maximum_bytes=MAX_CONTRACT_BYTES)
        compose_config = load_json_document(
            arguments.compose_config,
            maximum_bytes=MAX_COMPOSE_CONFIG_BYTES,
        )
        compose_authority = arguments.compose_authority.resolve().relative_to(
            REPOSITORY_ROOT.resolve()
        )
        source_authority = APP_ROOT.resolve().relative_to(REPOSITORY_ROOT.resolve())
        services = validate_worker_contract(
            contract,
            compose_config,
            host_repository_root=arguments.host_repository_root,
            expected_source_authority=source_authority.as_posix(),
            expected_compose_authority=compose_authority.as_posix(),
        )
    except (OSError, ValueError) as error:
        print(f"Animated Fabric worker contract validation failed: {error}", file=sys.stderr)
        return 1
    print(
        f"Animated Fabric worker contract validated {len(services)} services: "
        f"{', '.join(services)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
