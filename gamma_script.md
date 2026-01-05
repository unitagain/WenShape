# NOVIX Gamma 演示文稿脚本

---
**[Page 1: 封面]**
# NOVIX: 让 AI 真正记住你的世界
## 深度上下文感知的多智能体小说创作系统
### Context-Aware Multi-Agent Novel Writing System

---
**[Page 2: 痛点引入 - 3秒抓住眼球]**
# 写长篇？AI 有个致命伤： "健忘"

- 📉 **逻辑崩坏**：写到第 50 章，主角忘了第 1 章的承诺
- 😵 **设定 OOC**：高冷剑客突然变成了话痨
- 🗑️ **Token 浪费**：为了保持记忆，每次把几十万字塞进上下文？太贵且无效！

> "这不是创作，这是在对抗遗忘。"

---
**[Page 3: 核心架构 - 真正的 4-Agent 工作流]**
# 不止是 Chatbot，而是精密协作的「AI 编辑部」

我们不相信单一模型能写好长篇。NOVIX 设计了严密的 **4 智能体循环 (The Loop)**：

1.  ✍️ **Writer (撰稿人)**：
    *   专注单章节创作，负责文笔与叙事节奏
    *   基于当前大纲生成初稿
2.  🧐 **Reviewer (审阅员)**：
    *   拥有 "批判性思维"，检查逻辑漏洞与 OOC
    *   提出具体的修改建议，绝不姑息烂文
3.  📝 **Editor (编辑)**：
    *   综合审阅意见，进行润色与修订
    *   输出最终定稿
4.  🗃️ **Archivist (档案员)**：
    *   **幕后核心！** 永不休息的记忆守护者
    *   不参与写作，只负责从定稿中提取新设定并归档

---
**[Page 4: 独家技术 - 深度设定卡片系统]**
# Character Card System: 定义灵魂

普通 AI 只记名字，NOVIX 记住**灵魂**。
我们的设定卡片系统 (Card Schema) 包含极其丰富的维度：

*   🆔 **基本信息**：姓名、阵营、核心身份
*   🎨 **Appearance (外貌)**：发色、瞳色、衣着细节 (支持 Stable Diffusion 提示词转换)
*   🧠 **Personality (性格)**：MBTI、通过 Tag 管理的性格关键词，确保语气一致性
*   🕸️ **Relationship (羁绊)**：动态维护的人际关系网 (如：A 是 B 的救命恩人)

> "所有卡片均支持 YAML 格式导入/导出，方便版本管理。"

---
**[Page 5: 记忆引擎 - Deep Context Engineering]**
# 它是如何"记住"一切的？

拥有了卡片还不够，关键是如何**用好**它。

1.  **实时监听 (Live Listening)**
    *   Archivist 实时扫描正文，自动更新卡片状态 (如：主角受伤 -> 状态更新)
2.  **动态事实表 (Dynamic Canon)**
    *   一条贯穿全文的时间轴，记录不可逆的关键事件
3.  **精准召回 (Context Retrieval)**
    *   写到下一章时，系统自动计算相关性，只召回 Top 5% 的卡片与事实
    *   **结果**：0 幻觉，100% 逻辑闭环，Token 消耗降低 90%

---
**[Page 6: 重磅更新 - 同人创作神器]**
# 新功能：世界观「冷启动」引擎
## Fanfiction Support & Batch Extraction

写同人原本需要手动整理几十页设定？**现在只需 30 秒。**

*   🌐 **Wiki 直连**: 支持萌娘百科 / Fandom / Wikipedia
*   ⚡ **极速提取**: 10 线程并发爬虫 + LLM 聚合处理
*   🧬 **自动构建**: 自动将 Wiki 页面转化为上述的**深度设定卡片**

> "输入一个链接，还你一个完整的世界。"

---
**[Page 7: 结尾 - 愿景与开源]**
# Talk is cheap, Show me the code.

NOVIX 现已完全开源。
我们致力于探索 LLM 在长文本逻辑一致性上的边界。

*   ⭐️ **GitHub**: unitagain/NOVIX
*   📦 **Tech Stack**: Python (FastAPI) + React + LangChain

**加入我们，一起构建下一代 AI 写作工具。**
