"""Contracts for resolved Compose delivery of bounded Animated Fabric workers."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from scripts.validate_worker_contract import (
    MAX_CONTRACT_BYTES,
    WorkerContractError,
    load_json_document,
    validate_worker_contract,
)

APP_ROOT = Path(__file__).resolve().parents[2]
HOST_ROOT = "/srv/caatuu"
SOURCE_AUTHORITY = "apps/animated-fabric"
SOURCE_ROOT = f"{HOST_ROOT}/{SOURCE_AUTHORITY}"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return value


def _contract() -> dict[str, object]:
    return load_json_document(
        APP_ROOT / "containers/worker-contract.json",
        maximum_bytes=MAX_CONTRACT_BYTES,
    )


def _resolved_compose(contract: dict[str, object]) -> dict[str, object]:
    services: dict[str, object] = {
        "caatuu-dev": {
            "profiles": ["dev"],
            "stdin_open": True,
            "tty": True,
            "volumes": [
                {
                    "type": "bind",
                    "source": HOST_ROOT,
                    "target": "/workspace",
                }
            ],
        }
    }
    workers = _object(contract["workers"])
    for worker_id, raw_worker in workers.items():
        worker = _object(raw_worker)
        service_name = worker["service"]
        image = worker["image"]
        profile = worker["profile"]
        assert isinstance(service_name, str)
        assert isinstance(image, str)
        assert isinstance(profile, str)
        services[service_name] = {
            "build": {"context": SOURCE_ROOT},
            "cap_drop": ["ALL"],
            "image": image,
            "network_mode": "none",
            "profiles": [profile],
            "read_only": True,
            "security_opt": ["no-new-privileges:true"],
            "volumes": [
                {
                    "type": "bind",
                    "source": f"{SOURCE_ROOT}/workspaces/{worker_id}",
                    "target": "/output",
                }
            ],
        }
    return {"name": "caatuu", "services": services}


def _worker_service(
    compose: dict[str, object], contract: dict[str, object], worker_id: str
) -> dict[str, object]:
    workers = _object(contract["workers"])
    worker = _object(workers[worker_id])
    service_name = worker["service"]
    assert isinstance(service_name, str)
    services = _object(compose["services"])
    return _object(services[service_name])


def _validate(contract: dict[str, object], compose: dict[str, object]) -> tuple[str, ...]:
    return validate_worker_contract(
        contract,
        compose,
        host_repository_root=HOST_ROOT,
        expected_source_authority=SOURCE_AUTHORITY,
        expected_compose_authority="compose.yaml",
    )


def test_worker_contract_accepts_matching_resolved_compose() -> None:
    contract = _contract()
    compose = _resolved_compose(contract)

    services = _validate(contract, compose)

    expected_services: list[str] = []
    for _, raw_worker in sorted(_object(contract["workers"]).items()):
        service_name = _object(raw_worker)["service"]
        assert isinstance(service_name, str)
        expected_services.append(service_name)
    assert services == tuple(expected_services)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("network_mode", "bridge", "network_mode none"),
        ("read_only", False, "read-only root filesystem"),
        ("cap_drop", [], "drop all Linux capabilities"),
        ("security_opt", [], "prevent new privileges"),
        ("stdin_open", True, "must not be interactive"),
        ("ports", ["8000:8000"], "must not expose"),
    ],
)
def test_worker_contract_rejects_security_drift(field: str, value: object, message: str) -> None:
    contract = _contract()
    compose = _resolved_compose(contract)
    service = _worker_service(compose, contract, "blender_directional")
    service[field] = value

    with pytest.raises(WorkerContractError, match=message):
        _validate(contract, compose)


def test_worker_contract_rejects_image_and_profile_drift() -> None:
    contract = _contract()
    compose = _resolved_compose(contract)
    service = _worker_service(compose, contract, "blender_actor")
    service["image"] = "wrong-image:latest"

    with pytest.raises(WorkerContractError, match="image disagrees"):
        _validate(contract, compose)

    compose = _resolved_compose(contract)
    service = _worker_service(compose, contract, "blender_actor")
    service["profiles"] = ["wrong-profile"]
    with pytest.raises(WorkerContractError, match="profiles disagrees"):
        _validate(contract, compose)


def test_worker_contract_rejects_parallel_source_authority_and_docker_socket() -> None:
    contract = _contract()
    compose = _resolved_compose(contract)
    service = _worker_service(compose, contract, "blender_macaw")
    service["volumes"] = [{"type": "bind", "source": SOURCE_ROOT, "target": "/workspace"}]

    with pytest.raises(WorkerContractError, match="source-authority root"):
        _validate(contract, compose)

    compose = _resolved_compose(contract)
    service = _worker_service(compose, contract, "blender_macaw")
    service["volumes"] = [{"type": "bind", "source": "/srv", "target": "/input"}]
    with pytest.raises(WorkerContractError, match="source-authority root"):
        _validate(contract, compose)

    compose = _resolved_compose(contract)
    service = _worker_service(compose, contract, "blender_macaw")
    service["volumes"] = [
        {
            "type": "bind",
            "source": "/var/run/docker.sock",
            "target": "/var/run/docker.sock",
        }
    ]
    with pytest.raises(WorkerContractError, match="Docker socket"):
        _validate(contract, compose)


def test_worker_contract_rejects_wrong_build_and_development_mount_roots() -> None:
    contract = _contract()
    compose = _resolved_compose(contract)
    service = _worker_service(compose, contract, "cutout_classic")
    _object(service["build"])["context"] = "/srv/parallel/animated-fabric"

    with pytest.raises(WorkerContractError, match="canonical source authority"):
        _validate(contract, compose)

    compose = _resolved_compose(contract)
    development = _object(_object(compose["services"])["caatuu-dev"])
    development["volumes"] = [{"type": "bind", "source": "/srv/parallel", "target": "/workspace"}]
    with pytest.raises(WorkerContractError, match="canonical repository once"):
        _validate(contract, compose)


def test_worker_contract_rejects_registry_and_project_drift() -> None:
    contract = _contract()
    compose = _resolved_compose(contract)
    compose["name"] = "parallel-project"

    with pytest.raises(WorkerContractError, match="project name disagrees"):
        _validate(contract, compose)

    drifted_contract = deepcopy(contract)
    drifted_contract["source_authority"] = "demos/animated-fabric"
    with pytest.raises(WorkerContractError, match="source_authority is not canonical"):
        _validate(drifted_contract, _resolved_compose(drifted_contract))


def test_worker_contract_normalizes_windows_host_paths() -> None:
    contract = _contract()
    compose = _resolved_compose(contract)
    services = _object(compose["services"])
    development = _object(services["caatuu-dev"])
    development["volumes"] = [
        {
            "type": "bind",
            "source": r"C:\WORK\CAATUU",
            "target": "/workspace",
        }
    ]
    for raw_worker in _object(contract["workers"]).values():
        worker = _object(raw_worker)
        service_name = worker["service"]
        assert isinstance(service_name, str)
        service = _object(services[service_name])
        _object(service["build"])["context"] = r"C:\Work\caatuu\apps\animated-fabric"

    services = validate_worker_contract(
        contract,
        compose,
        host_repository_root=r"C:\Work\caatuu",
        expected_source_authority=SOURCE_AUTHORITY,
        expected_compose_authority="compose.yaml",
    )

    assert len(services) == len(_object(contract["workers"]))
