#!/usr/bin/env python3
"""dao-code cache-stability rig - A4 P0-1 (跨 session rig 骨架，2026-07-09)。

测 02-context 缓存稳定段 claim："前缀字节稳定 -> 高 prompt-cache-hit"（dao-code 报 95.8%）。
A arm 稳定前缀 vs B arm 漂移前缀（注入 turn+时间戳破前缀），N≥10 取 median。

需：pip install anthropic + ANTHROPIC_API_KEY 有额度。
纯只读 API 调用，无副作用，成本 < $1（N×2 次 max_tokens=32）。
跑通后把 median+delta 写回 02-context 缓存稳定段作 receipt，evidence-audit 自动翻转。

设计文档：E:/cc/cross-session-rig-skeleton.md
"""
import os, time, statistics
from anthropic import Anthropic

client = Anthropic()  # 读 ANTHROPIC_API_KEY 环境变量
MODEL = os.environ.get("RIG_MODEL", "claude-sonnet-5")
N = int(os.environ.get("RIG_N", "10"))  # A4: N≥10 取 median

STABLE_SYSTEM = ("You are a coding assistant. " * 50)  # 长前缀，字节跨轮不变

def drift_system(i):
    """B arm：注入 volatile 破坏前缀稳定。"""
    return STABLE_SYSTEM + f"\n[turn {i} {time.time()}]"

def run_arm(system_fn):
    hit_rates = []
    for i in range(N):
        sys_text = system_fn(i) if callable(system_fn) else system_fn
        resp = client.messages.create(
            model=MODEL, max_tokens=32,
            system=[{"type": "text", "text": sys_text, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": f"task {i}: reply OK"}],
        )
        u = resp.usage
        read = getattr(u, "cache_read_input_tokens", 0)
        created = getattr(u, "cache_creation_input_tokens", 0)
        inp = u.input_tokens
        tot = read + created + inp
        hit_rates.append(read / tot if tot else 0)
    return statistics.median(hit_rates), hit_rates

if __name__ == "__main__":
    print(f"model={MODEL} N={N}")
    a_med, a_all = run_arm(lambda i: STABLE_SYSTEM)   # A: 稳定前缀
    b_med, b_all = run_arm(drift_system)               # B: 漂移前缀
    print(f"stable prefix cache-hit median: {a_med:.1%}  ({[f'{x:.0%}' for x in a_all]})")
    print(f"drift  prefix cache-hit median: {b_med:.1%}  ({[f'{x:.0%}' for x in b_all]})")
    print(f"delta: +{(a_med-b_med):.1%}  (正=稳定有效，验证 dao-code claim)")
    gate_pass = a_med > b_med and (a_med - b_med) > 0.30
    print(f"GATE: {'PASS' if gate_pass else 'FAIL/NEEDS-REVIEW'}")
