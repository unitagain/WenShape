# 📌 待办事项 (TODO) 跟踪清单

本文档跟踪代码库中未解决的TODO注释，确保这些改进点不被遗忘。

---

## 🔴 高优先级

### 1. 冲突检测实现
**文件**: `backend/app/agents/archivist.py:143`  
**当前代码**:
```python
"conflicts": []  # TODO: Implement conflict detection / 待实现：冲突检测
```

**描述**: 
Archivist需要实现设定冲突检测功能，当新的卡片信息与已有Canon（事实表）冲突时，应该标记出来供用户决策。

**建议实现**:
1. 比较新CardProposal与现有Cards的关键字段（name, description, personality等）
2. 使用相似度算法（如Levenshtein距离）检测矛盾
3. 返回冲突列表，包含：冲突类型、冲突字段、旧值、新值

**预计工作量**: 4-6小时

---

## 🟡 中优先级

### 2. 优化相关性评分算法
**文件**: `backend/app/context_engine/selector.py:156`  
**当前代码**:
```python
# TODO: Implement more sophisticated relevance scoring
```

**描述**:
当前上下文选择器使用简单的关键词匹配来选择相关卡片。可以改进为：
- TF-IDF向量相似度
- Embedding-based语义相似度
- 混合评分策略

**建议实现**:
1. 短期：增加TF-IDF权重，考虑卡片类型（Character vs Setting）
2. 长期：集成Sentence Transformers进行语义匹配

**预计工作量**: 2-3小时（短期）/ 1-2天（长期）

---

## 📝 跟踪说明

- **创建日期**: 2026-01-17
- **最后更新**: 2026-01-17
- **总TODO数**: 2个

### 更新流程
1. 当实现某个TODO时，在此文档中标记为 `[已完成]`
2. 每月review一次，评估优先级
3. 新增TODO时，同步更新此文档

---

## ✅ 已完成的TODO

暂无
