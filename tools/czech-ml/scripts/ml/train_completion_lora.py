#!/usr/bin/env python3
"""Train a LoRA adapter on prompt/completion rows for Caatuu utility models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, PeftModel, TaskType, get_peft_model
from torch.utils.data import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments


ROOT = Path(__file__).resolve().parents[2] / "data" / "models"
HF_CACHE = ROOT / "english-base" / "hf-cache"


class CompletionDataset(Dataset):
    def __init__(
        self,
        path: Path,
        tokenizer: Any,
        max_length: int,
        prompt_field: str,
        completion_field: str,
        limit: int | None = None,
    ):
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if limit:
            rows = rows[:limit]
        self.rows = rows
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.prompt_field = prompt_field
        self.completion_field = completion_field

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int) -> dict[str, list[int]]:
        row = self.rows[idx]
        prompt = str(row[self.prompt_field])
        completion = str(row[self.completion_field])
        eos = self.tokenizer.eos_token or ""
        full = prompt + completion + eos
        prompt_ids = self.tokenizer(prompt, add_special_tokens=False)["input_ids"]
        full_ids = self.tokenizer(
            full,
            add_special_tokens=False,
            max_length=self.max_length,
            truncation=True,
        )["input_ids"]
        labels = [-100] * min(len(prompt_ids), len(full_ids)) + full_ids[len(prompt_ids) :]
        labels = labels[: len(full_ids)]
        return {"input_ids": full_ids, "labels": labels, "attention_mask": [1] * len(full_ids)}


class CausalCollator:
    def __init__(self, tokenizer: Any):
        self.tokenizer = tokenizer

    def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, torch.Tensor]:
        max_len = max(len(f["input_ids"]) for f in features)
        pad_id = self.tokenizer.pad_token_id
        batch = {"input_ids": [], "attention_mask": [], "labels": []}
        for feature in features:
            pad = max_len - len(feature["input_ids"])
            batch["input_ids"].append(feature["input_ids"] + [pad_id] * pad)
            batch["attention_mask"].append(feature["attention_mask"] + [0] * pad)
            batch["labels"].append(feature["labels"] + [-100] * pad)
        return {key: torch.tensor(value, dtype=torch.long) for key, value in batch.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default="BUT-FIT/CSTinyLlama-1.2B")
    parser.add_argument("--adapter-in", default=None, help="Optional existing PEFT adapter to continue training.")
    parser.add_argument("--train", required=True)
    parser.add_argument("--val", default=None, help="Optional disjoint validation JSONL.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--prompt-field", default="prompt")
    parser.add_argument("--completion-field", default="completion")
    parser.add_argument("--max-length", type=int, default=192)
    parser.add_argument("--max-steps", type=int, default=8000)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument(
        "--lora-targets",
        default="q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj",
        help="Comma-separated module names for LoRA injection.",
    )
    parser.add_argument("--warmup-steps", type=int, default=200)
    parser.add_argument("--logging-steps", type=int, default=20)
    parser.add_argument("--eval-steps", type=int, default=500)
    parser.add_argument("--save-steps", type=int, default=1000)
    parser.add_argument("--save-total-limit", type=int, default=3)
    parser.add_argument("--lr-scheduler-type", default="cosine")
    parser.add_argument("--resume-from-checkpoint", default=None)
    parser.add_argument("--limit-examples", type=int, default=None)
    parser.add_argument("--load-best-model-at-end", action="store_true")
    args = parser.parse_args()

    if args.load_best_model_at_end and not args.val:
        parser.error("--load-best-model-at-end requires --val")

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available; refusing to run this fine-tune on CPU.")

    tokenizer = AutoTokenizer.from_pretrained(args.model_id, cache_dir=HF_CACHE, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        cache_dir=HF_CACHE,
        torch_dtype=torch.float16,
        trust_remote_code=True,
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False
    model.config.pad_token_id = tokenizer.pad_token_id
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()

    target_modules = [item.strip() for item in args.lora_targets.split(",") if item.strip()]
    if args.adapter_in:
        model = PeftModel.from_pretrained(model, args.adapter_in, is_trainable=True)
    else:
        lora = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=args.lora_r,
            lora_alpha=args.lora_alpha,
            lora_dropout=args.lora_dropout,
            target_modules=target_modules,
        )
        model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    train_ds = CompletionDataset(
        Path(args.train),
        tokenizer,
        args.max_length,
        args.prompt_field,
        args.completion_field,
        args.limit_examples,
    )
    val_ds = (
        CompletionDataset(
            Path(args.val),
            tokenizer,
            args.max_length,
            args.prompt_field,
            args.completion_field,
        )
        if args.val
        else None
    )
    has_validation = val_ds is not None
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(out / "checkpoints"),
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=args.grad_accum,
        max_steps=args.max_steps,
        learning_rate=args.learning_rate,
        warmup_steps=args.warmup_steps,
        logging_steps=args.logging_steps,
        eval_steps=args.eval_steps,
        save_steps=args.save_steps,
        save_total_limit=args.save_total_limit,
        fp16=True,
        optim="adamw_torch",
        report_to=[],
        eval_strategy="steps" if has_validation else "no",
        save_strategy="steps",
        lr_scheduler_type=args.lr_scheduler_type,
        gradient_checkpointing=True,
        remove_unused_columns=False,
        dataloader_num_workers=0,
        load_best_model_at_end=args.load_best_model_at_end and has_validation,
        metric_for_best_model="eval_loss" if has_validation else None,
        greater_is_better=False if has_validation else None,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        data_collator=CausalCollator(tokenizer),
    )
    trainer.train(resume_from_checkpoint=args.resume_from_checkpoint)
    adapter_dir = out / "adapter"
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    metadata = {
        "base_model": args.model_id,
        "adapter_in": args.adapter_in,
        "adapter_dir": str(adapter_dir),
        "train": args.train,
        "validation": args.val,
        "train_examples": len(train_ds),
        "validation_examples": len(val_ds) if val_ds is not None else 0,
        "prompt_field": args.prompt_field,
        "completion_field": args.completion_field,
        "max_steps": args.max_steps,
        "max_length": args.max_length,
        "batch_size": args.batch_size,
        "gradient_accumulation_steps": args.grad_accum,
        "learning_rate": args.learning_rate,
        "lora_r": args.lora_r,
        "lora_alpha": args.lora_alpha,
        "lora_dropout": args.lora_dropout,
        "lora_target_modules": target_modules,
        "warmup_steps": args.warmup_steps,
        "logging_steps": args.logging_steps,
        "eval_steps": args.eval_steps,
        "save_steps": args.save_steps,
        "save_total_limit": args.save_total_limit,
        "lr_scheduler_type": args.lr_scheduler_type,
        "load_best_model_at_end": args.load_best_model_at_end and has_validation,
        "metric_for_best_model": "eval_loss" if has_validation else None,
        "greater_is_better": False if has_validation else None,
        "best_model_checkpoint": trainer.state.best_model_checkpoint,
        "best_metric": trainer.state.best_metric,
        "global_step": trainer.state.global_step,
    }
    (out / "training-run.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
