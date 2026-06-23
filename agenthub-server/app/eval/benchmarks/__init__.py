"""外部基准评测（HumanEval+ / SWE-bench Lite）接入层。

定位：
- HumanEval+（humaneval.py）：单函数补全，测**底座模型**，作单 agent 基线 / 管线冒烟。
- SWE-bench Lite（swebench.py）：仓库级 issue 修复，测**多 Agent 编排**，作主指标。

设计原则：每个基准都拆成「数据加载 → 解题/产出 → 判分」三段，且都提供
**离线零依赖冒烟路径**（内置样本 + 桩），保证「先跑通管线，再按需接真实模型/数据」。
"""
