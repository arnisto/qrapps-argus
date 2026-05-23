#!/usr/bin/env python3
# =============================================================================
# ATLAS v2 — 3D Ischemic Stroke Lesion Segmentation
# nnU-Net-inspired baseline pipeline (MONAI + PyTorch)
# -----------------------------------------------------------------------------
# Single-file, end-to-end, production-quality training & inference pipeline.
#
# Quick start:
#   python atlas_nnunet_pipeline.py \
#       --data_root /path/to/ATLAS_2 \
#       --epochs 200 \
#       --batch_size 2
#
# Inference only on the test split (skips training):
#   python atlas_nnunet_pipeline.py \
#       --data_root /path/to/ATLAS_2 \
#       --infer_only \
#       --resume results/nnUnet/run_YYYYMMDD_HHMMSS/best_model.pt
#
# Dataset structure (BIDS):
#   ATLAS_2/
#   ├── train/<COHORT>/sub-*/ses-*/anat/{T1w.nii.gz, lesion_mask.nii.gz}
#   └── test /<COHORT>/sub-*/ses-*/anat/T1w.nii.gz
# =============================================================================

# -----------------------------------------------------------------------------
# 1. IMPORTS
# -----------------------------------------------------------------------------
from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import random
import re
import shutil
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

# Headless plotting (works on servers without display).
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Torch / MONAI / Nibabel are heavy deps; import lazily-friendly but at module
# level since the pipeline absolutely requires them.
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torch.utils.tensorboard import SummaryWriter

import nibabel as nib

import monai
from monai.data import CacheDataset, Dataset, decollate_batch, MetaTensor
from monai.inferers import sliding_window_inference
from monai.losses import DiceCELoss
from monai.metrics import DiceMetric, MeanIoU, HausdorffDistanceMetric
from monai.networks.nets import DynUNet
from monai.transforms import (
    Activations,
    AsDiscrete,
    Compose,
    CropForegroundd,
    EnsureChannelFirstd,
    EnsureTyped,
    LoadImaged,
    NormalizeIntensityd,
    Orientationd,
    RandCropByPosNegLabeld,
    ScaleIntensityRangePercentilesd,
    Spacingd,
    SpatialPadd,
)
from monai.utils import set_determinism


# =============================================================================
# 2. CONFIGURATION
# =============================================================================

@dataclass
class Config:
    """All training / inference hyperparameters in one place.

    Anything that affects results lives here so we can serialise it to disk
    for reproducibility (config.json + hyperparameters.json).
    """

    # ---- paths -----------------------------------------------------------
    data_root: str = "ATLAS_2"
    output_root: str = "results/nnUnet"
    run_name: Optional[str] = None  # If None, auto = run_YYYYMMDD_HHMMSS.

    # ---- reproducibility -------------------------------------------------
    seed: int = 42
    deterministic: bool = True

    # ---- data ------------------------------------------------------------
    val_fraction: float = 0.2
    cache_rate: float = 0.0  # 0.0 = lazy (memory friendly); raise on big RAM.
    num_workers: int = 4

    # ---- preprocessing ---------------------------------------------------
    target_spacing: Tuple[float, float, float] = (1.0, 1.0, 1.0)
    orientation: str = "RAS"
    # ATLAS v2 T1w volumes vary in intensity scale; we percentile-normalise
    # then z-score within the brain foreground.
    intensity_lower_pct: float = 0.5
    intensity_upper_pct: float = 99.5

    # ---- patch / batching -----------------------------------------------
    patch_size: Tuple[int, int, int] = (128, 128, 128)
    batch_size: int = 2
    samples_per_volume: int = 2  # RandCropByPosNegLabel samples per volume.
    pos_neg_ratio: float = 1.0   # 1:1 positive/negative patches.

    # ---- model (nnU-Net via MONAI DynUNet) ------------------------------
    # Strides/kernels picked for ~128^3 patches and 1mm isotropic spacing —
    # matches nnU-Net's "3d_fullres" defaults for medium-sized volumes.
    kernels: Tuple[Tuple[int, int, int], ...] = (
        (3, 3, 3), (3, 3, 3), (3, 3, 3), (3, 3, 3), (3, 3, 3), (3, 3, 3),
    )
    strides: Tuple[Tuple[int, int, int], ...] = (
        (1, 1, 1), (2, 2, 2), (2, 2, 2), (2, 2, 2), (2, 2, 2), (2, 2, 2),
    )
    deep_supervision: bool = True
    deep_supr_num: int = 2  # number of additional supervision heads
    base_features: int = 32

    # ---- optimisation ----------------------------------------------------
    epochs: int = 200
    lr: float = 1e-2
    weight_decay: float = 3e-5
    momentum: float = 0.99
    nesterov: bool = True
    optimizer: str = "sgd"  # {sgd, adamw}
    scheduler: str = "poly"  # nnU-Net's polynomial LR decay.
    poly_power: float = 0.9
    grad_clip: float = 12.0

    # ---- loss ------------------------------------------------------------
    dice_ce_lambda_dice: float = 1.0
    dice_ce_lambda_ce: float = 1.0

    # ---- validation / inference -----------------------------------------
    val_interval: int = 1
    sw_batch_size: int = 4
    sw_overlap: float = 0.5
    sw_mode: str = "gaussian"

    # ---- early stopping --------------------------------------------------
    early_stop_patience: int = 50
    early_stop_min_delta: float = 1e-4

    # ---- misc ------------------------------------------------------------
    amp: bool = True
    log_every: int = 10
    save_val_predictions: bool = True
    n_viz_cases: int = 6  # How many qualitative examples to render.
    infer_only: bool = False
    resume: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # Tuples → lists for JSON.
        for k, v in d.items():
            if isinstance(v, tuple):
                d[k] = list(v)
        return d


# =============================================================================
# 3. REPRODUCIBILITY
# =============================================================================

def seed_everything(seed: int, deterministic: bool = True) -> None:
    """Make the pipeline as deterministic as cuDNN / MONAI allow.

    Note: full determinism on GPU can slow training by 10-20% — usually worth
    it for a publishable baseline.
    """
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    set_determinism(seed=seed)
    if deterministic:
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
    else:
        torch.backends.cudnn.benchmark = True


# =============================================================================
# 4. LOGGING
# =============================================================================

def build_logger(log_path: Path) -> logging.Logger:
    """Logger that writes simultaneously to stdout and `training_log.txt`."""
    logger = logging.getLogger("atlas_nnunet")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("[%(asctime)s][%(levelname)s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    fh = logging.FileHandler(log_path, mode="a")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.propagate = False
    return logger


# =============================================================================
# 5. BIDS DATA PARSER
# =============================================================================

_T1_SUFFIX_RE = re.compile(r".*T1w\.nii(\.gz)?$", re.IGNORECASE)
_MASK_SUFFIX_RE = re.compile(r".*(lesion[_\-]?mask|label-L_mask)\.nii(\.gz)?$",
                             re.IGNORECASE)


def _find_anat_files(anat_dir: Path) -> Tuple[Optional[Path], Optional[Path]]:
    """Return (t1_path, mask_path) for a given .../anat/ directory."""
    t1, mask = None, None
    if not anat_dir.is_dir():
        return None, None
    for p in anat_dir.iterdir():
        name = p.name
        if _T1_SUFFIX_RE.match(name):
            t1 = p
        elif _MASK_SUFFIX_RE.match(name):
            mask = p
    return t1, mask


def discover_bids_cases(root: Path, require_mask: bool,
                        logger: logging.Logger) -> List[Dict[str, str]]:
    """Recursively walk a BIDS-like tree and collect (image, label) pairs.

    Robust to:
      - missing sessions
      - missing masks (skipped with a warning if `require_mask=True`)
      - additional non-anat folders
    """
    if not root.exists():
        logger.warning(f"Path does not exist: {root}")
        return []

    cases: List[Dict[str, str]] = []
    # BIDS structure: ROOT / <COHORT> / sub-* / ses-* / anat /
    for anat_dir in sorted(root.glob("**/anat")):
        # Re-build a stable case ID from the BIDS hierarchy.
        parts = anat_dir.parts
        try:
            sub = next(p for p in parts if p.startswith("sub-"))
            ses = next((p for p in parts if p.startswith("ses-")), "ses-1")
        except StopIteration:
            continue
        case_id = f"{sub}_{ses}"

        t1, mask = _find_anat_files(anat_dir)
        if t1 is None:
            logger.debug(f"[skip] no T1w in {anat_dir}")
            continue
        if require_mask and mask is None:
            logger.warning(f"[skip] no lesion mask in {anat_dir}")
            continue

        entry: Dict[str, str] = {"image": str(t1), "case_id": case_id}
        if mask is not None:
            entry["label"] = str(mask)
        cases.append(entry)

    logger.info(f"Discovered {len(cases)} cases under {root}")
    return cases


def split_train_val(cases: List[Dict[str, str]], val_fraction: float,
                    seed: int) -> Tuple[List[Dict[str, str]],
                                        List[Dict[str, str]]]:
    """Deterministic shuffle then split by fraction."""
    rng = random.Random(seed)
    shuffled = cases.copy()
    rng.shuffle(shuffled)
    n_val = max(1, int(round(len(shuffled) * val_fraction)))
    return shuffled[n_val:], shuffled[:n_val]


# =============================================================================
# 6. TRANSFORMS / PREPROCESSING
# =============================================================================

def build_train_transforms(cfg: Config) -> Compose:
    """Training augmentation pipeline.

    Baseline run: only the deterministic preprocessing + crop sampling
    (no spatial/intensity augmentation as per spec).
    """
    keys = ["image", "label"]
    return Compose([
        LoadImaged(keys=keys, image_only=False),
        EnsureChannelFirstd(keys=keys),
        Orientationd(keys=keys, axcodes=cfg.orientation),
        Spacingd(keys=keys, pixdim=cfg.target_spacing,
                 mode=("bilinear", "nearest")),
        ScaleIntensityRangePercentilesd(
            keys="image",
            lower=cfg.intensity_lower_pct,
            upper=cfg.intensity_upper_pct,
            b_min=0.0, b_max=1.0, clip=True,
        ),
        CropForegroundd(keys=keys, source_key="image",
                        allow_smaller=True),
        NormalizeIntensityd(keys="image", nonzero=True, channel_wise=True),
        SpatialPadd(keys=keys, spatial_size=cfg.patch_size),
        RandCropByPosNegLabeld(
            keys=keys, label_key="label",
            spatial_size=cfg.patch_size,
            pos=cfg.pos_neg_ratio, neg=1.0,
            num_samples=cfg.samples_per_volume,
            image_key="image", image_threshold=0,
            allow_smaller=True,
        ),
        EnsureTyped(keys=keys, track_meta=False),
    ])


def build_val_transforms(cfg: Config) -> Compose:
    """Validation pipeline — same preprocessing, no random crop."""
    keys = ["image", "label"]
    return Compose([
        LoadImaged(keys=keys, image_only=False),
        EnsureChannelFirstd(keys=keys),
        Orientationd(keys=keys, axcodes=cfg.orientation),
        Spacingd(keys=keys, pixdim=cfg.target_spacing,
                 mode=("bilinear", "nearest")),
        ScaleIntensityRangePercentilesd(
            keys="image",
            lower=cfg.intensity_lower_pct,
            upper=cfg.intensity_upper_pct,
            b_min=0.0, b_max=1.0, clip=True,
        ),
        NormalizeIntensityd(keys="image", nonzero=True, channel_wise=True),
        EnsureTyped(keys=keys, track_meta=True),
    ])


def build_test_transforms(cfg: Config) -> Compose:
    """Inference pipeline — image only, keep meta for re-saving NIfTI."""
    return Compose([
        LoadImaged(keys=["image"], image_only=False),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes=cfg.orientation),
        Spacingd(keys=["image"], pixdim=cfg.target_spacing,
                 mode="bilinear"),
        ScaleIntensityRangePercentilesd(
            keys="image",
            lower=cfg.intensity_lower_pct,
            upper=cfg.intensity_upper_pct,
            b_min=0.0, b_max=1.0, clip=True,
        ),
        NormalizeIntensityd(keys="image", nonzero=True, channel_wise=True),
        EnsureTyped(keys=["image"], track_meta=True),
    ])


# =============================================================================
# 7. MODEL — nnU-Net (MONAI DynUNet)
# =============================================================================

def build_model(cfg: Config) -> nn.Module:
    """Construct the nnU-Net 3D model.

    We use MONAI's DynUNet, which is a faithful implementation of the
    nnU-Net architecture (encoder/decoder with instance norm, leaky ReLU,
    and optional deep supervision heads).
    """
    return DynUNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=2,                       # bg + lesion
        kernel_size=cfg.kernels,
        strides=cfg.strides,
        upsample_kernel_size=cfg.strides[1:],  # mirrors strides (per nnU-Net)
        norm_name=("INSTANCE", {"affine": True}),
        act_name=("leakyrelu", {"inplace": True, "negative_slope": 0.01}),
        deep_supervision=cfg.deep_supervision,
        deep_supr_num=cfg.deep_supr_num,
        res_block=False,
        filters=[cfg.base_features * (2 ** i)
                 for i in range(len(cfg.strides))],
    )


def summarise_model(model: nn.Module) -> str:
    """Return a short, file-safe architecture summary."""
    n_params = sum(p.numel() for p in model.parameters())
    n_train = sum(p.numel() for p in model.parameters() if p.requires_grad)
    lines = [
        f"Model class    : {model.__class__.__name__}",
        f"Total params   : {n_params:,}",
        f"Trainable      : {n_train:,}",
        "",
        repr(model),
    ]
    return "\n".join(lines)


# =============================================================================
# 8. LOSS / METRICS
# =============================================================================

class DeepSupervisionLoss(nn.Module):
    """Wraps DiceCE for nnU-Net's multi-resolution deep supervision.

    DynUNet returns shape (B, S, C, D, H, W) in training mode where S is the
    number of supervision heads (highest-res first). We weight heads by 1/2**i
    and re-normalise, per nnU-Net.
    """

    def __init__(self, lambda_dice: float = 1.0, lambda_ce: float = 1.0):
        super().__init__()
        self.criterion = DiceCELoss(
            to_onehot_y=True, softmax=True,
            lambda_dice=lambda_dice, lambda_ce=lambda_ce,
            include_background=False,
        )

    def forward(self, preds: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        if preds.ndim == target.ndim + 1 and preds.shape[1] != target.shape[1]:
            # (B, S, C, D, H, W) — deep supervision path.
            heads = torch.unbind(preds, dim=1)
            weights = torch.tensor(
                [1.0 / (2 ** i) for i in range(len(heads))],
                device=preds.device,
            )
            weights = weights / weights.sum()
            losses = [self.criterion(h, target) for h in heads]
            return sum(w * l for w, l in zip(weights, losses))
        return self.criterion(preds, target)


# =============================================================================
# 9. TRAINER
# =============================================================================

class Trainer:
    """End-to-end trainer: optimisation + validation + checkpointing.

    Kept as a class so state (best dice, history, paths) lives in one place.
    """

    def __init__(self, cfg: Config, run_dir: Path, model: nn.Module,
                 device: torch.device, logger: logging.Logger,
                 train_loader: DataLoader, val_loader: DataLoader,
                 val_files: List[Dict[str, str]]):
        self.cfg = cfg
        self.run_dir = run_dir
        self.device = device
        self.logger = logger
        self.model = model.to(device)
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.val_files = val_files

        # Optimiser ---------------------------------------------------------
        if cfg.optimizer == "sgd":
            self.optimizer = torch.optim.SGD(
                self.model.parameters(), lr=cfg.lr,
                momentum=cfg.momentum, nesterov=cfg.nesterov,
                weight_decay=cfg.weight_decay,
            )
        else:
            self.optimizer = torch.optim.AdamW(
                self.model.parameters(), lr=cfg.lr,
                weight_decay=cfg.weight_decay,
            )

        # Polynomial LR — nnU-Net standard.
        def poly_lr(epoch: int) -> float:
            return (1 - epoch / max(1, cfg.epochs)) ** cfg.poly_power
        self.scheduler = torch.optim.lr_scheduler.LambdaLR(
            self.optimizer, lr_lambda=poly_lr)

        # Loss & metrics ----------------------------------------------------
        self.loss_fn = DeepSupervisionLoss(
            lambda_dice=cfg.dice_ce_lambda_dice,
            lambda_ce=cfg.dice_ce_lambda_ce,
        )
        self.dice_metric = DiceMetric(
            include_background=False, reduction="mean",
            get_not_nans=False,
        )
        self.iou_metric = MeanIoU(
            include_background=False, reduction="mean",
        )

        # Inference post-processing ----------------------------------------
        self.post_pred = Compose([Activations(softmax=True),
                                  AsDiscrete(argmax=True, to_onehot=2)])
        self.post_label = Compose([AsDiscrete(to_onehot=2)])

        # AMP scaler --------------------------------------------------------
        self.scaler = torch.cuda.amp.GradScaler(enabled=cfg.amp)

        # Bookkeeping -------------------------------------------------------
        self.writer = SummaryWriter(log_dir=str(run_dir / "tensorboard"))
        self.best_dice: float = -1.0
        self.best_epoch: int = -1
        self.epochs_no_improve: int = 0
        self.history: Dict[str, List[float]] = {
            "epoch": [], "train_loss": [], "val_dice": [],
            "val_iou": [], "lr": [],
        }

    # ------------------------------------------------------------------
    # Training step
    # ------------------------------------------------------------------
    def train_one_epoch(self, epoch: int) -> float:
        self.model.train()
        total_loss, n_batches = 0.0, 0
        t0 = time.time()
        for step, batch in enumerate(self.train_loader, 1):
            images = batch["image"].to(self.device, non_blocking=True)
            labels = batch["label"].to(self.device, non_blocking=True)

            self.optimizer.zero_grad(set_to_none=True)
            with torch.cuda.amp.autocast(enabled=self.cfg.amp):
                logits = self.model(images)
                loss = self.loss_fn(logits, labels)

            self.scaler.scale(loss).backward()
            self.scaler.unscale_(self.optimizer)
            torch.nn.utils.clip_grad_norm_(
                self.model.parameters(), self.cfg.grad_clip)
            self.scaler.step(self.optimizer)
            self.scaler.update()

            total_loss += float(loss.item())
            n_batches += 1
            if step % self.cfg.log_every == 0:
                self.logger.info(
                    f"  epoch {epoch:04d} step {step:04d}/"
                    f"{len(self.train_loader)}  loss={loss.item():.4f}  "
                    f"lr={self.optimizer.param_groups[0]['lr']:.2e}")

        avg = total_loss / max(1, n_batches)
        self.logger.info(
            f"epoch {epoch:04d}  train_loss={avg:.4f}  "
            f"time={time.time() - t0:.1f}s")
        return avg

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    @torch.no_grad()
    def validate(self, epoch: int,
                 save_preds_dir: Optional[Path]) -> Tuple[float, float,
                                                          List[Dict[str, Any]]]:
        self.model.eval()
        self.dice_metric.reset()
        self.iou_metric.reset()
        per_case: List[Dict[str, Any]] = []

        for idx, batch in enumerate(self.val_loader):
            images = batch["image"].to(self.device, non_blocking=True)
            labels = batch["label"].to(self.device, non_blocking=True)

            with torch.cuda.amp.autocast(enabled=self.cfg.amp):
                logits = sliding_window_inference(
                    inputs=images,
                    roi_size=self.cfg.patch_size,
                    sw_batch_size=self.cfg.sw_batch_size,
                    predictor=self.model,
                    overlap=self.cfg.sw_overlap,
                    mode=self.cfg.sw_mode,
                )

            # decollate + post-process per item in the batch (batch size is 1
            # during validation by construction).
            preds = [self.post_pred(p) for p in decollate_batch(logits)]
            tgts = [self.post_label(l) for l in decollate_batch(labels)]
            self.dice_metric(y_pred=preds, y=tgts)
            self.iou_metric(y_pred=preds, y=tgts)

            # Per-case dice (foreground class only).
            case_dice = self.dice_metric.aggregate().item()
            self.dice_metric.reset()
            self.dice_metric(y_pred=preds, y=tgts)  # keep running mean
            case_id = self.val_files[idx]["case_id"]
            per_case.append({"case_id": case_id, "dice": float(case_dice)})

            # Save NIfTI predictions + overlay for the first few cases.
            if save_preds_dir is not None and idx < self.cfg.n_viz_cases:
                save_prediction_nifti(
                    pred=preds[0], reference=images[0],
                    out_dir=save_preds_dir,
                    case_id=case_id, suffix=f"epoch{epoch:04d}",
                )
                save_overlay_png(
                    image=images[0].detach().cpu().numpy()[0],
                    label=tgts[0].detach().cpu().numpy()[1],
                    pred=preds[0].detach().cpu().numpy()[1],
                    out_path=save_preds_dir
                    / f"{case_id}_epoch{epoch:04d}_overlay.png",
                    title=f"{case_id} | dice={case_dice:.3f}",
                )

        dice = self.dice_metric.aggregate().item()
        iou = self.iou_metric.aggregate().item()
        self.dice_metric.reset()
        self.iou_metric.reset()
        return dice, iou, per_case

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------
    def fit(self) -> None:
        ckpt_best = self.run_dir / "best_model.pt"
        ckpt_last = self.run_dir / "last_model.pt"
        metrics_csv = self.run_dir / "metrics.csv"
        per_case_dir = self.run_dir / "validation_predictions"
        per_case_dir.mkdir(parents=True, exist_ok=True)

        with open(metrics_csv, "w", newline="") as fh:
            csv.writer(fh).writerow(
                ["epoch", "train_loss", "val_dice", "val_iou", "lr"])

        for epoch in range(1, self.cfg.epochs + 1):
            train_loss = self.train_one_epoch(epoch)
            self.scheduler.step()

            val_dice, val_iou, per_case = -1.0, -1.0, []
            if epoch % self.cfg.val_interval == 0:
                save_dir = (per_case_dir
                            if self.cfg.save_val_predictions else None)
                val_dice, val_iou, per_case = self.validate(epoch, save_dir)
                self.logger.info(
                    f"epoch {epoch:04d}  val_dice={val_dice:.4f}  "
                    f"val_iou={val_iou:.4f}")

                # Persist per-epoch per-case metrics.
                pc_path = per_case_dir / f"per_case_epoch{epoch:04d}.csv"
                with open(pc_path, "w", newline="") as fh:
                    w = csv.writer(fh)
                    w.writerow(["case_id", "dice"])
                    for row in per_case:
                        w.writerow([row["case_id"], f"{row['dice']:.6f}"])

            # Update history + TB + CSV.
            lr = self.optimizer.param_groups[0]["lr"]
            self.history["epoch"].append(epoch)
            self.history["train_loss"].append(train_loss)
            self.history["val_dice"].append(val_dice)
            self.history["val_iou"].append(val_iou)
            self.history["lr"].append(lr)
            self.writer.add_scalar("train/loss", train_loss, epoch)
            self.writer.add_scalar("val/dice", val_dice, epoch)
            self.writer.add_scalar("val/iou", val_iou, epoch)
            self.writer.add_scalar("train/lr", lr, epoch)
            with open(metrics_csv, "a", newline="") as fh:
                csv.writer(fh).writerow(
                    [epoch, f"{train_loss:.6f}",
                     f"{val_dice:.6f}", f"{val_iou:.6f}", f"{lr:.6e}"])

            # Save "last" every epoch (cheap insurance against crashes).
            self._save_checkpoint(ckpt_last, epoch, val_dice)

            # Early-stop / best tracking.
            if val_dice > self.best_dice + self.cfg.early_stop_min_delta:
                self.best_dice = val_dice
                self.best_epoch = epoch
                self.epochs_no_improve = 0
                self._save_checkpoint(ckpt_best, epoch, val_dice)
                self.logger.info(
                    f"  ↑ new best dice={val_dice:.4f} → saved {ckpt_best.name}")
            else:
                self.epochs_no_improve += 1
                if self.epochs_no_improve >= self.cfg.early_stop_patience:
                    self.logger.info(
                        f"Early stopping after {self.epochs_no_improve} "
                        f"epochs without improvement.")
                    break

        self._render_curves()
        self.writer.close()
        self.logger.info(
            f"Training done. Best dice={self.best_dice:.4f} "
            f"at epoch {self.best_epoch}.")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _save_checkpoint(self, path: Path, epoch: int, val_dice: float) -> None:
        torch.save({
            "epoch": epoch,
            "val_dice": val_dice,
            "model": self.model.state_dict(),
            "optimizer": self.optimizer.state_dict(),
            "scheduler": self.scheduler.state_dict(),
            "scaler": self.scaler.state_dict(),
            "cfg": self.cfg.to_dict(),
        }, path)

    def _render_curves(self) -> None:
        h = self.history
        # Loss curve.
        fig, ax = plt.subplots(figsize=(8, 5))
        ax.plot(h["epoch"], h["train_loss"], label="train loss")
        ax.set(xlabel="epoch", ylabel="loss", title="Training loss")
        ax.grid(True, alpha=0.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(self.run_dir / "loss_curve.png", dpi=130)
        plt.close(fig)

        # Dice curve.
        fig, ax = plt.subplots(figsize=(8, 5))
        valid = [(e, d) for e, d in zip(h["epoch"], h["val_dice"]) if d >= 0]
        if valid:
            es, ds = zip(*valid)
            ax.plot(es, ds, label="val dice", color="tab:green")
        ax.set(xlabel="epoch", ylabel="dice", title="Validation Dice",
               ylim=(0, 1))
        ax.grid(True, alpha=0.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(self.run_dir / "dice_curve.png", dpi=130)
        plt.close(fig)

        # Combined learning curve (loss + dice on twin axes).
        fig, ax1 = plt.subplots(figsize=(9, 5))
        ax1.plot(h["epoch"], h["train_loss"],
                 color="tab:red", label="train loss")
        ax1.set(xlabel="epoch", ylabel="loss")
        ax2 = ax1.twinx()
        if valid:
            ax2.plot(es, ds, color="tab:green", label="val dice")
        ax2.set(ylabel="dice", ylim=(0, 1))
        ax1.set_title("Learning curves")
        fig.tight_layout()
        fig.savefig(self.run_dir / "learning_curves.png", dpi=130)
        plt.close(fig)


# =============================================================================
# 10. INFERENCE & I/O HELPERS
# =============================================================================

def _affine_from_meta(reference: Any) -> np.ndarray:
    """Pull a 4x4 affine off a MONAI MetaTensor (fallback to identity)."""
    if isinstance(reference, MetaTensor):
        aff = reference.affine
        if isinstance(aff, torch.Tensor):
            aff = aff.detach().cpu().numpy()
        return np.asarray(aff)
    return np.eye(4)


def save_prediction_nifti(pred: torch.Tensor, reference: Any,
                          out_dir: Path, case_id: str,
                          suffix: str = "",
                          save_prob: bool = False,
                          prob: Optional[torch.Tensor] = None) -> None:
    """Persist a one-hot prediction as a binary mask NIfTI.

    `pred` shape: (C, D, H, W). Channel 1 == lesion.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    mask = pred[1].detach().cpu().numpy().astype(np.uint8)
    affine = _affine_from_meta(reference)
    name = f"{case_id}" + (f"_{suffix}" if suffix else "") + "_pred.nii.gz"
    nib.save(nib.Nifti1Image(mask, affine), str(out_dir / name))

    if save_prob and prob is not None:
        prob_np = prob[1].detach().cpu().numpy().astype(np.float32)
        nib.save(nib.Nifti1Image(prob_np, affine),
                 str(out_dir / f"{case_id}_prob.nii.gz"))


def save_overlay_png(image: np.ndarray, label: Optional[np.ndarray],
                     pred: np.ndarray, out_path: Path,
                     title: str = "") -> None:
    """Three-panel qualitative figure (axial mid-slice + lesion-centric).

    Choosing the slice with maximum lesion area (GT if available, else pred)
    is far more informative than just the middle slice for ATLAS, where many
    lesions are small.
    """
    # Determine the most informative axial slice.
    if label is not None and label.sum() > 0:
        per_slice = label.sum(axis=(0, 1))
    elif pred.sum() > 0:
        per_slice = pred.sum(axis=(0, 1))
    else:
        per_slice = np.ones(image.shape[-1])
    z = int(np.argmax(per_slice))

    fig, axes = plt.subplots(1, 3, figsize=(13, 4.6))
    img_sl = image[..., z]
    axes[0].imshow(img_sl.T, cmap="gray", origin="lower")
    axes[0].set_title("T1w")
    axes[1].imshow(img_sl.T, cmap="gray", origin="lower")
    if label is not None:
        axes[1].contour(label[..., z].T, levels=[0.5],
                        colors="lime", linewidths=1.0)
    axes[1].set_title("Ground truth")
    axes[2].imshow(img_sl.T, cmap="gray", origin="lower")
    axes[2].contour(pred[..., z].T, levels=[0.5],
                    colors="red", linewidths=1.0)
    axes[2].set_title("Prediction")
    for a in axes:
        a.axis("off")
    if title:
        fig.suptitle(title, fontsize=11)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120, bbox_inches="tight")
    plt.close(fig)


def run_inference(cfg: Config, model: nn.Module, device: torch.device,
                  test_files: List[Dict[str, str]],
                  out_dir: Path, logger: logging.Logger,
                  has_labels: bool = False) -> List[Dict[str, Any]]:
    """Sliding-window inference on every file under `test_files`.

    Saves: binary mask NIfTI, probability NIfTI, qualitative PNG overlay.
    If `has_labels=True` (i.e. running test-time eval against held-out GT),
    also computes per-case Dice.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    transforms = (build_val_transforms(cfg) if has_labels
                  else build_test_transforms(cfg))
    ds = Dataset(data=test_files, transform=transforms)
    loader = DataLoader(ds, batch_size=1, shuffle=False,
                        num_workers=cfg.num_workers, pin_memory=True)

    post_softmax = Activations(softmax=True)
    post_argmax = AsDiscrete(argmax=True, to_onehot=2)
    post_label = AsDiscrete(to_onehot=2)
    dice_metric = DiceMetric(include_background=False, reduction="mean")

    per_case: List[Dict[str, Any]] = []
    model.eval()
    with torch.no_grad():
        for idx, batch in enumerate(loader):
            case_id = test_files[idx]["case_id"]
            image = batch["image"].to(device, non_blocking=True)

            with torch.cuda.amp.autocast(enabled=cfg.amp):
                logits = sliding_window_inference(
                    inputs=image,
                    roi_size=cfg.patch_size,
                    sw_batch_size=cfg.sw_batch_size,
                    predictor=model,
                    overlap=cfg.sw_overlap,
                    mode=cfg.sw_mode,
                )

            probs = [post_softmax(p) for p in decollate_batch(logits)]
            preds = [post_argmax(p) for p in probs]

            dice_val = float("nan")
            label_np: Optional[np.ndarray] = None
            if has_labels and "label" in batch:
                labels = batch["label"].to(device, non_blocking=True)
                tgts = [post_label(l) for l in decollate_batch(labels)]
                dice_metric.reset()
                dice_metric(y_pred=preds, y=tgts)
                dice_val = float(dice_metric.aggregate().item())
                label_np = tgts[0].detach().cpu().numpy()[1]

            save_prediction_nifti(
                pred=preds[0], reference=image[0],
                out_dir=out_dir, case_id=case_id,
                save_prob=True, prob=probs[0],
            )
            save_overlay_png(
                image=image[0].detach().cpu().numpy()[0],
                label=label_np,
                pred=preds[0].detach().cpu().numpy()[1],
                out_path=out_dir / f"{case_id}_overlay.png",
                title=(f"{case_id}"
                       + (f" | dice={dice_val:.3f}" if has_labels else "")),
            )

            per_case.append({"case_id": case_id, "dice": dice_val,
                             "n_voxels_pred": int(
                                 preds[0][1].sum().item())})
            logger.info(f"[infer {idx + 1}/{len(loader)}] {case_id}"
                        + (f" dice={dice_val:.4f}" if has_labels else ""))

    return per_case


# =============================================================================
# 11. ENTRY POINT
# =============================================================================

def parse_args() -> Config:
    """CLI → Config. Only the most-likely-to-tweak knobs are exposed."""
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--data_root", type=str, default="ATLAS_2")
    p.add_argument("--output_root", type=str, default="results/nnUnet")
    p.add_argument("--epochs", type=int, default=200)
    p.add_argument("--batch_size", type=int, default=2)
    p.add_argument("--lr", type=float, default=1e-2)
    p.add_argument("--num_workers", type=int, default=4)
    p.add_argument("--patch", type=int, nargs=3, default=(128, 128, 128))
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--val_fraction", type=float, default=0.2)
    p.add_argument("--no_amp", action="store_true",
                   help="disable mixed precision")
    p.add_argument("--no_deterministic", action="store_true")
    p.add_argument("--cache_rate", type=float, default=0.0)
    p.add_argument("--early_stop_patience", type=int, default=50)
    p.add_argument("--infer_only", action="store_true",
                   help="skip training, run inference using --resume")
    p.add_argument("--resume", type=str, default=None,
                   help="path to a checkpoint (.pt) to load before "
                        "training/inference")
    p.add_argument("--run_name", type=str, default=None)
    args = p.parse_args()

    cfg = Config()
    cfg.data_root = args.data_root
    cfg.output_root = args.output_root
    cfg.epochs = args.epochs
    cfg.batch_size = args.batch_size
    cfg.lr = args.lr
    cfg.num_workers = args.num_workers
    cfg.patch_size = tuple(args.patch)
    cfg.seed = args.seed
    cfg.val_fraction = args.val_fraction
    cfg.amp = not args.no_amp
    cfg.deterministic = not args.no_deterministic
    cfg.cache_rate = args.cache_rate
    cfg.early_stop_patience = args.early_stop_patience
    cfg.infer_only = args.infer_only
    cfg.resume = args.resume
    cfg.run_name = args.run_name
    return cfg


def make_run_dir(cfg: Config) -> Path:
    """results/nnUnet/run_<timestamp>/ with all subfolders."""
    name = cfg.run_name or f"run_{datetime.now():%Y%m%d_%H%M%S}"
    root = Path(cfg.output_root) / name
    for sub in ("validation_predictions", "test_predictions",
                "tensorboard", "visualizations"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def maybe_load_checkpoint(model: nn.Module, path: Optional[str],
                          device: torch.device,
                          logger: logging.Logger) -> None:
    if path is None:
        return
    p = Path(path)
    if not p.exists():
        logger.warning(f"--resume path does not exist: {p}")
        return
    ckpt = torch.load(p, map_location=device)
    state = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
    model.load_state_dict(state, strict=False)
    logger.info(f"Loaded weights from {p}")


def write_summary_metrics(per_case: List[Dict[str, Any]],
                          out_path: Path) -> None:
    """Aggregate per-case metrics into a single JSON summary."""
    dices = [c["dice"] for c in per_case
             if isinstance(c.get("dice"), float) and not np.isnan(c["dice"])]
    summary = {
        "n_cases": len(per_case),
        "mean_dice": float(np.mean(dices)) if dices else None,
        "median_dice": float(np.median(dices)) if dices else None,
        "std_dice": float(np.std(dices)) if dices else None,
        "min_dice": float(np.min(dices)) if dices else None,
        "max_dice": float(np.max(dices)) if dices else None,
    }
    with open(out_path, "w") as fh:
        json.dump(summary, fh, indent=2)


def save_worst_best(per_case: List[Dict[str, Any]],
                    pred_dir: Path, out_dir: Path,
                    k: int = 3) -> None:
    """Copy the k worst and k best overlay PNGs to a shortlist folder."""
    out_dir.mkdir(parents=True, exist_ok=True)
    valid = [c for c in per_case if not np.isnan(c.get("dice", float("nan")))]
    if not valid:
        return
    valid.sort(key=lambda c: c["dice"])
    for tag, items in (("worst", valid[:k]), ("best", valid[-k:][::-1])):
        for rank, c in enumerate(items, 1):
            src = next(pred_dir.glob(f"{c['case_id']}*overlay.png"), None)
            if src is not None and src.exists():
                shutil.copy(src,
                            out_dir
                            / f"{tag}_{rank:02d}_dice{c['dice']:.3f}_"
                              f"{c['case_id']}.png")


def main() -> None:
    cfg = parse_args()

    # ---- run dir + logging ----------------------------------------------
    run_dir = make_run_dir(cfg)
    logger = build_logger(run_dir / "training_log.txt")
    logger.info(f"=== ATLAS v2 nnU-Net baseline | run dir = {run_dir} ===")
    logger.info(f"Python {sys.version.split()[0]}  torch {torch.__version__}  "
                f"monai {monai.__version__}")

    # ---- determinism -----------------------------------------------------
    seed_everything(cfg.seed, deterministic=cfg.deterministic)

    # ---- device ----------------------------------------------------------
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Device: {device}"
                + (f" ({torch.cuda.get_device_name(0)})"
                   if device.type == "cuda" else ""))

    # ---- persist config --------------------------------------------------
    with open(run_dir / "config.json", "w") as fh:
        json.dump(cfg.to_dict(), fh, indent=2)
    with open(run_dir / "hyperparameters.json", "w") as fh:
        # Same content, but split out for downstream tooling that expects it.
        json.dump(cfg.to_dict(), fh, indent=2)

    # ---- discover data ---------------------------------------------------
    train_root = Path(cfg.data_root) / "train"
    test_root = Path(cfg.data_root) / "test"
    train_all = discover_bids_cases(train_root, require_mask=True,
                                    logger=logger)
    test_cases = discover_bids_cases(test_root, require_mask=False,
                                     logger=logger)
    if not train_all and not cfg.infer_only:
        logger.error("No training cases discovered — aborting.")
        sys.exit(1)

    train_files, val_files = split_train_val(
        train_all, cfg.val_fraction, cfg.seed)
    logger.info(f"Train cases: {len(train_files)}  "
                f"Val cases: {len(val_files)}  "
                f"Test cases: {len(test_cases)}")

    # Persist split IDs for reproducibility.
    with open(run_dir / "split.json", "w") as fh:
        json.dump({
            "train": [c["case_id"] for c in train_files],
            "val": [c["case_id"] for c in val_files],
            "test": [c["case_id"] for c in test_cases],
        }, fh, indent=2)

    # ---- model -----------------------------------------------------------
    model = build_model(cfg)
    with open(run_dir / "model_summary.txt", "w") as fh:
        fh.write(summarise_model(model))
    maybe_load_checkpoint(model, cfg.resume, device, logger)

    # ---- training --------------------------------------------------------
    if not cfg.infer_only:
        train_tf = build_train_transforms(cfg)
        val_tf = build_val_transforms(cfg)

        # CacheDataset trades RAM for speed; defaults to lazy to play nice with
        # small machines. Bump cfg.cache_rate to 1.0 on big-RAM nodes.
        train_ds = CacheDataset(data=train_files, transform=train_tf,
                                cache_rate=cfg.cache_rate,
                                num_workers=cfg.num_workers)
        val_ds = CacheDataset(data=val_files, transform=val_tf,
                              cache_rate=cfg.cache_rate,
                              num_workers=cfg.num_workers)
        train_loader = DataLoader(
            train_ds, batch_size=cfg.batch_size, shuffle=True,
            num_workers=cfg.num_workers, pin_memory=(device.type == "cuda"),
            drop_last=True, persistent_workers=cfg.num_workers > 0,
        )
        val_loader = DataLoader(
            val_ds, batch_size=1, shuffle=False,
            num_workers=cfg.num_workers, pin_memory=(device.type == "cuda"),
            persistent_workers=cfg.num_workers > 0,
        )

        trainer = Trainer(cfg=cfg, run_dir=run_dir, model=model,
                          device=device, logger=logger,
                          train_loader=train_loader, val_loader=val_loader,
                          val_files=val_files)
        trainer.fit()

        # Reload best weights for inference.
        best_path = run_dir / "best_model.pt"
        if best_path.exists():
            maybe_load_checkpoint(model, str(best_path), device, logger)

    # ---- final validation pass (per-case CSV + worst/best gallery) -------
    if val_files:
        logger.info("Final validation pass (best weights)…")
        val_dir = run_dir / "validation_final"
        val_per_case = run_inference(
            cfg=cfg, model=model.to(device), device=device,
            test_files=val_files, out_dir=val_dir,
            logger=logger, has_labels=True,
        )
        with open(val_dir / "per_case_metrics.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["case_id", "dice", "n_voxels_pred"])
            for c in val_per_case:
                w.writerow([c["case_id"], f"{c['dice']:.6f}",
                            c["n_voxels_pred"]])
        write_summary_metrics(val_per_case,
                              val_dir / "summary_metrics.json")
        save_worst_best(val_per_case, val_dir,
                        run_dir / "visualizations" / "val_worst_best",
                        k=3)

    # ---- inference on test set ------------------------------------------
    if test_cases:
        logger.info("Running inference on test split…")
        test_dir = run_dir / "test_predictions"
        test_per_case = run_inference(
            cfg=cfg, model=model.to(device), device=device,
            test_files=test_cases, out_dir=test_dir,
            logger=logger, has_labels=False,
        )
        with open(test_dir / "per_case_metrics.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["case_id", "n_voxels_pred"])
            for c in test_per_case:
                w.writerow([c["case_id"], c["n_voxels_pred"]])

    logger.info("All done. Artifacts in: " + str(run_dir))


if __name__ == "__main__":
    main()
