"""Pinned, offline-only BiRefNet provider."""

from __future__ import annotations

from pathlib import Path

from tools.cutout.errors import MissingDependencyError, ModelUnavailableError
from tools.cutout.image_io import open_rgba
from tools.cutout.integrity import model_snapshot_path, require_valid_model_snapshot
from tools.cutout.prefetch import validate_model_revision
from tools.cutout.types import CutoutOptions, CutoutResult

_MODEL_CACHE: dict[tuple[str, str, str, str], object] = {}


def _select_device(torch, requested: str):
    if requested == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        raise MissingDependencyError("CUDA was requested, but PyTorch cannot access CUDA.")
    return torch.device(requested)


def _last_tensor(value):
    if hasattr(value, "logits"):
        return value.logits
    if isinstance(value, (list, tuple)):
        return _last_tensor(value[-1])
    return value


def _load_model(
    torch,
    auto_model,
    *,
    model_name: str,
    model_revision: str,
    model_cache: Path,
    device,
):
    revision = validate_model_revision(model_revision)
    key = (model_name, revision, str(model_cache.resolve()), str(device))
    if key not in _MODEL_CACHE:
        snapshot = model_snapshot_path(model_name, revision, model_cache)
        if not snapshot.is_dir():
            raise ModelUnavailableError(
                f"Pinned model {model_name}@{revision} is unavailable in {model_cache}. "
                "Run the explicit cutout prefetch service with network access first."
            )
        require_valid_model_snapshot(
            snapshot,
            model_name=model_name,
            model_revision=revision,
        )
        try:
            model = auto_model.from_pretrained(
                model_name,
                revision=revision,
                code_revision=revision,
                cache_dir=str(model_cache),
                trust_remote_code=True,
                local_files_only=True,
            )
        except OSError as exc:
            raise ModelUnavailableError(
                f"Pinned model {model_name}@{revision} is unavailable in {model_cache}. "
                "Run the explicit cutout prefetch service with network access first."
            ) from exc
        model.to(device)
        if device.type == "cpu":
            model.float()
        model.eval()
        _MODEL_CACHE[key] = model
    return _MODEL_CACHE[key]


def run(input_path: Path, options: CutoutOptions) -> CutoutResult:
    """Infer a foreground alpha mask using a cached immutable BiRefNet snapshot."""
    try:
        import torch
        from PIL import Image
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation
    except ImportError as exc:
        raise MissingDependencyError(
            "BiRefNet needs a Dockerfile.cutout CPU or CUDA image target."
        ) from exc

    image = open_rgba(input_path)
    rgb = image.convert("RGB")
    original_size = rgb.size
    device = _select_device(torch, options.device)
    model = _load_model(
        torch,
        AutoModelForImageSegmentation,
        model_name=options.model_name,
        model_revision=options.model_revision,
        model_cache=options.model_cache,
        device=device,
    )

    size = options.input_size
    transform = transforms.Compose(
        [
            transforms.Resize((size, size), interpolation=transforms.InterpolationMode.BILINEAR),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    dtype = next(model.parameters()).dtype
    tensor = transform(rgb).unsqueeze(0).to(device=device, dtype=dtype)

    with torch.no_grad():
        prediction = _last_tensor(model(tensor))
        prediction = prediction.sigmoid().detach().float().cpu()[0]
        if prediction.ndim == 3:
            prediction = prediction[0]
        prediction = (prediction - prediction.min()) / (prediction.max() - prediction.min() + 1e-6)

    alpha = transforms.ToPILImage()(prediction).resize(original_size, Image.Resampling.LANCZOS)
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    hard_mask = alpha.point(lambda pixel: 255 if pixel >= 128 else 0, mode="L")

    return CutoutResult(
        rgba=rgba,
        alpha=alpha,
        hard_mask=hard_mask,
        diagnostics={
            "engine": "birefnet",
            "model": options.model_name,
            "model_revision": options.model_revision,
            "device": str(device),
            "input_size": size,
            "preset": options.preset,
        },
    )
