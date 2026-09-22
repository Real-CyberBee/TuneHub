#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Real-CyberBee
"""
TuneHub 内容包校验器。

用途：贡献者在提交内容包之前先在本地跑一遍，明确知道自己错在哪。
没有它，贡献者只能靠 CI 报错来试错——那会把绝大多数潜在贡献者劝退。

用法：
    python3 examples/validate.py [内容包目录]
    python3 examples/validate.py examples/content-pack

它同时演示了 CI 中应当实施的检查项：
  1. 结构完整性（必填字段、id 命名规范）
  2. provenance 必填与 accuracy 枚举（学术诚信的强制点）
  3. kind 与所在目录一致
  4. 跨文件引用可解析（scale→tuning、style→其它）
  5. 领域合理性（音阶度数递增、节奏步数与层长度一致、频率为正、密度范围）
  6. license 必填

注意：这是原型实现。正式版应在 packages/content-schema 里用 JSON Schema + TS 实现，
并由注册表和浏览器内编辑器共用同一套规则。
"""

import json
import os
import sys

KINDS = {
    "tunings": "tuning",
    "scales": "scale",
    "frameworks": "framework",
    "rhythms": "rhythm",
    "styles": "style",
    "voices": "voice",
    "themes": "theme",
}
ACCURACY_ENUM = {"measured", "theoretical", "approximation", "simplified"}
TUNING_TYPES = {"edo", "ratio-set", "measured", "formula"}

errors = []
warnings = []


def err(path, msg):
    errors.append(f"  ✗ [{path}] {msg}")


def warn(path, msg):
    warnings.append(f"  ! [{path}] {msg}")


def load_pack(root):
    docs = []
    for dirname, kind in KINDS.items():
        d = os.path.join(root, dirname)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".json"):
                continue
            rel = os.path.join(dirname, fn)
            try:
                with open(os.path.join(d, fn), encoding="utf-8") as f:
                    docs.append((rel, kind, json.load(f)))
            except json.JSONDecodeError as e:
                err(rel, f"JSON 解析失败: {e}")
    return docs


def check_envelope(path, kind, doc):
    for field in ("id", "version", "kind", "name", "provenance", "license", "data"):
        if field not in doc:
            err(path, f"缺少必填字段 `{field}`")
    if doc.get("kind") != kind:
        err(path, f"kind='{doc.get('kind')}' 与所在目录（应为 {kind}）不一致")

    ident = doc.get("id", "")
    if ident and (ident != ident.lower() or " " in ident or "_" in ident):
        err(path, f"id='{ident}' 不符合 kebab-case 规范（小写、连字符分隔）")

    name = doc.get("name")
    if isinstance(name, dict):
        if "en" not in name:
            warn(path, "name 缺少 'en' 键（建议至少提供英文名）")
    elif name is not None:
        warn(path, "name 建议使用多语言对象 {en:..., zh:...} 而非字符串")

    # provenance —— 本项目最关键的检查项
    prov = doc.get("provenance", {})
    if isinstance(prov, dict):
        if not prov.get("sources"):
            err(path, "provenance.sources 为空——无出处的内容不允许进入内容库")
        else:
            for s in prov["sources"]:
                if not s.get("citation"):
                    err(path, "provenance.sources 中存在缺少 citation 的条目")
                if "placeholder" in (s.get("url") or ""):
                    warn(path, "出处 URL 仍是占位符，合入前必须替换")
        acc = prov.get("accuracy")
        if acc not in ACCURACY_ENUM:
            err(path, f"provenance.accuracy='{acc}' 不在允许值 {sorted(ACCURACY_ENUM)} 内")
        if not prov.get("limitations"):
            warn(path, "建议填写 provenance.limitations，说明本实现的近似与缺失")

    if not doc.get("license"):
        err(path, "缺少 license（内容许可须独立于代码许可）")


def check_tuning(path, doc):
    d = doc.get("data", {})
    t = d.get("type")
    if t not in TUNING_TYPES:
        err(path, f"tuning.type='{t}' 不在 {sorted(TUNING_TYPES)} 内")
        return
    if t == "measured":
        freqs = d.get("frequenciesHz") or []
        if not freqs:
            err(path, "type=measured 必须提供 frequenciesHz")
        if any((not isinstance(f, (int, float))) or f <= 0 for f in freqs):
            err(path, "frequenciesHz 必须为正数")
        if freqs != sorted(freqs):
            err(path, "frequenciesHz 必须按升序排列")
        if d.get("referenceHz") is not None and freqs and d["referenceHz"] not in freqs:
            warn(path, "referenceHz 不在 frequenciesHz 中")
    elif t == "edo":
        n = d.get("divisions")
        if not isinstance(n, int) or n < 1:
            err(path, "type=edo 必须提供正整数 divisions")
    elif t == "ratio-set":
        ratios = d.get("ratios") or []
        if not ratios:
            err(path, "type=ratio-set 必须提供 ratios")
        for r in ratios:
            if not (isinstance(r, list) and len(r) == 2 and all(isinstance(x, int) and x > 0 for x in r)):
                err(path, f"ratios 条目应为 [正整数, 正整数]，得到 {r}")
    elif t == "formula":
        if not d.get("sonicWeaveExpr"):
            err(path, "type=formula 必须提供 sonicWeaveExpr")


def check_scale(path, doc, tunings):
    d = doc.get("data", {})
    tid = d.get("tuningId")
    if not tid:
        err(path, "scale 必须提供 tuningId")
    elif tid not in tunings:
        warn(path, f"tuningId='{tid}' 未在本内容包中找到（可能来自内置或其它包）")
    degrees = d.get("degrees") or []
    if not degrees:
        err(path, "scale 必须提供非空 degrees")
    elif degrees != sorted(degrees):
        warn(path, "degrees 建议按升序书写")
    if degrees and degrees[0] != 0:
        warn(path, "degrees 通常应从 0（主音）开始")


def check_rhythm(path, doc):
    d = doc.get("data", {})
    steps = d.get("cycleSteps")
    layers = d.get("layers") or []
    if not isinstance(steps, int) or steps < 1:
        err(path, "rhythm 必须提供正整数 cycleSteps")
        return
    if not layers:
        err(path, "rhythm 必须提供至少一个 layer")
    for i, layer in enumerate(layers):
        if not layer.get("voice"):
            err(path, f"layers[{i}] 缺少 voice")
        s = layer.get("steps")
        if not isinstance(s, list):
            err(path, f"layers[{i}].steps 必须是数组")
        elif len(s) != steps:
            err(path, f"layers[{i}] 的 steps 长度 {len(s)} != cycleSteps {steps}")
        elif any(v not in (0, 1) for v in s):
            err(path, f"layers[{i}].steps 只能包含 0 或 1")
    acc = d.get("accentPattern")
    if acc is not None and steps and steps % len(acc) != 0:
        warn(path, f"accentPattern 长度 {len(acc)} 不能整除 cycleSteps {steps}，重音循环无法对齐")
    swing = d.get("swing")
    if swing is not None and not (0.0 <= swing <= 1.0):
        err(path, f"swing={swing} 应在 0..1 之间")


def check_framework(path, doc):
    d = doc.get("data", {})
    if not d.get("scaleId"):
        err(path, "framework 必须提供 scaleId")
    if d.get("ascending") is not None and d.get("ascending") == d.get("descending"):
        warn(path, "ascending 与 descending 相同（对某些体系正常，但拉格/木卡姆通常不同）")
    emph = d.get("emphasis")
    if emph is not None and not isinstance(emph, dict):
        err(path, "emphasis 应为对象 {音级: 权重}")
    for i, p in enumerate(d.get("phrases") or []):
        if not isinstance(p.get("degrees"), list):
            err(path, f"phrases[{i}] 缺少 degrees 数组")


def check_style(path, doc, known_ids):
    d = doc.get("data", {})
    tid = (d.get("defaults") or {}).get("tuningId")
    if tid and tid not in known_ids:
        warn(path, f"defaults.tuningId='{tid}' 未找到（可能来自内置或其它包）")
    voices = d.get("voices") or []
    if not voices:
        err(path, "style 必须提供至少一个 voice 定义")
    seen = set()
    for i, v in enumerate(voices):
        vid = v.get("id")
        if not vid:
            err(path, f"voices[{i}] 缺少 id")
        elif vid in seen:
            err(path, f"voices[{i}].id='{vid}' 重复")
        else:
            seen.add(vid)
        for refkey in ("voiceRef", "rhythmRef", "frameworkRef"):
            ref = v.get(refkey)
            if ref and ref not in known_ids:
                warn(path, f"voices[{i}].{refkey}='{ref}' 未在本包中找到")
        dens = v.get("density")
        if dens is not None and not (0.0 <= dens <= 1.0):
            err(path, f"voices[{i}].density={dens} 应在 0..1 之间")
    for i, sec in enumerate(d.get("structure") or []):
        if "bars" not in sec:
            err(path, f"structure[{i}] 缺少 bars")


def check_voice(path, doc):
    d = doc.get("data", {})
    if not d.get("kind"):
        err(path, "voice 必须声明 data.kind（如 subtractive/fm/sampled）")
    env = d.get("envelope")
    if env:
        for k in ("attack", "decay", "release"):
            if k in env and env[k] < 0:
                err(path, f"envelope.{k} 不能为负")
    caps = d.get("capabilities") or {}
    if "offlineRenderable" not in caps:
        warn(path, "建议声明 capabilities.offlineRenderable（影响区间导出能否使用该音色）")


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "examples/content-pack"
    if not os.path.isdir(root):
        print(f"目录不存在: {root}")
        return 2

    docs = load_pack(root)
    if not docs:
        print(f"在 {root} 中未找到任何内容包")
        return 2

    id_index = {}
    for path, kind, doc in docs:
        ident = doc.get("id")
        if ident:
            if ident in id_index:
                err(path, f"id='{ident}' 与 {id_index[ident]} 冲突（id 必须全局唯一）")
            id_index[ident] = path

    tunings = {d.get("id") for _, k, d in docs if k == "tuning"}
    known_ids = set(id_index.keys())

    for path, kind, doc in docs:
        check_envelope(path, kind, doc)
        if kind == "tuning":
            check_tuning(path, doc)
        elif kind == "scale":
            check_scale(path, doc, tunings)
        elif kind == "rhythm":
            check_rhythm(path, doc)
        elif kind == "framework":
            check_framework(path, doc)
        elif kind == "style":
            check_style(path, doc, known_ids)
        elif kind == "voice":
            check_voice(path, doc)

    print(f"校验内容包: {root}")
    print(f"共 {len(docs)} 个文件，{len(id_index)} 个唯一 id\n")

    if warnings:
        print(f"警告 {len(warnings)} 条：")
        for w in warnings:
            print(w)
        print()

    if errors:
        print(f"错误 {len(errors)} 条：")
        for e in errors:
            print(e)
        print(f"\n❌ 校验未通过（{len(errors)} 个错误）")
        return 1

    print("✅ 校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
