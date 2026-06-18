"""f3：验收 golden set 基线数据集（spec-driven 质量门禁的标注样本）。

每条用例 = 需求 + EARS 验收标准（经 rubric_from_acceptance 转成 judge rubric）+ 一份代表性
产出 + 标注 expect_pass。正样本应被 judge 判为达标；负样本（错误/缺失产出）应被门禁拦下。
跑 golden set 得到「judge 与标注一致率（accuracy）」与「正样本通过率」，作为质量门禁基线。

与运行时复审同口径：rubric 也来自 EARS 验收（Phase 3：计划=评测），保证离线评测与线上一致。
"""

from __future__ import annotations

from app.eval.harness import GoldenCase, rubric_from_acceptance


def build_golden_set() -> list[GoldenCase]:
    """构造验收 golden set 基线（正样本 + 负样本控制）。"""
    return [
        # ── 正样本：产出满足 EARS 验收，应判达标 ───────────────────────────
        GoldenCase(
            name="add_function_correct",
            instruction="实现一个把两个整数相加的函数 add(a, b)。",
            rubric=rubric_from_acceptance(
                ["当传入两个整数 a、b，函数应返回它们的和 a+b。"]
            ),
            actual_output=(
                "```python\n"
                "def add(a: int, b: int) -> int:\n"
                "    return a + b\n"
                "```\n"
                "对任意整数 a、b 返回其和。"
            ),
            expect_pass=True,
        ),
        GoldenCase(
            name="pagination_endpoint",
            instruction="给列表接口加分页。",
            rubric=rubric_from_acceptance(
                [
                    "当请求带 page 与 size，接口应只返回该页数据。",
                    "响应应包含总条数 total，便于前端算总页数。",
                ]
            ),
            actual_output=(
                "```python\n"
                "@router.get('/items')\n"
                "def list_items(page: int = 1, size: int = 20):\n"
                "    offset = (page - 1) * size\n"
                "    rows = db.query(Item).offset(offset).limit(size).all()\n"
                "    total = db.query(Item).count()\n"
                "    return {'items': rows, 'total': total, 'page': page, 'size': size}\n"
                "```"
            ),
            expect_pass=True,
        ),
        GoldenCase(
            name="none_guard_bugfix",
            instruction="修复 parse_tags 在入参为 None 时崩溃的问题。",
            rubric=rubric_from_acceptance(
                ["当入参 raw 为 None，函数应返回空列表 []，而不是抛 AttributeError。"]
            ),
            actual_output=(
                "```python\n"
                "def parse_tags(raw: str | None) -> list[str]:\n"
                "    if not raw:\n"
                "        return []\n"
                "    return [t.strip() for t in raw.split(',') if t.strip()]\n"
                "```"
            ),
            expect_pass=True,
        ),
        GoldenCase(
            name="unit_test_coverage",
            instruction="为 add 函数补单元测试。",
            rubric=rubric_from_acceptance(
                [
                    "当运行测试，应覆盖正常用例与边界用例（如负数、零）。",
                    "所有断言应通过。",
                ]
            ),
            actual_output=(
                "```python\n"
                "def test_add_normal():\n"
                "    assert add(2, 3) == 5\n"
                "def test_add_zero():\n"
                "    assert add(0, 0) == 0\n"
                "def test_add_negative():\n"
                "    assert add(-1, -2) == -3\n"
                "```"
            ),
            expect_pass=True,
        ),
        # ── 负样本：产出错误/缺失，应被门禁拦下（judge 给低分）────────────────
        GoldenCase(
            name="add_function_wrong",
            instruction="实现一个把两个整数相加的函数 add(a, b)。",
            rubric=rubric_from_acceptance(
                ["当传入两个整数 a、b，函数应返回它们的和 a+b。"]
            ),
            actual_output=(
                "```python\n"
                "def add(a: int, b: int) -> int:\n"
                "    return a - b  # 实现成了相减\n"
                "```"
            ),
            expect_pass=False,
        ),
        GoldenCase(
            name="pagination_missing_total",
            instruction="给列表接口加分页。",
            rubric=rubric_from_acceptance(
                [
                    "当请求带 page 与 size，接口应只返回该页数据。",
                    "响应应包含总条数 total，便于前端算总页数。",
                ]
            ),
            actual_output=(
                "```python\n"
                "@router.get('/items')\n"
                "def list_items(page: int = 1, size: int = 20):\n"
                "    return db.query(Item).all()  # 没分页、也没返回 total\n"
                "```"
            ),
            expect_pass=False,
        ),
    ]
