# @deepseek-ai/dsh-skill-rome

[English](README.md) | 中文

可选的内置 skill（技能）提供方，向 `ctx.skills` 贡献 Rome 的工程 skill（`ask-matt`、`grilling`、`grill-me`、`grill-with-docs`、`to-spec`、`to-tickets`、`implement`、`wayfinder`）。

挂载该插件即可启用提供方。它贡献内置的工作流、规范制定、测试与执行纪律类 skill，并附带基于包相对路径的资源基底。

## Model Experience

### Skill catalog and loader

#### What the model sees

该包中允许模型调用的 skill（`grilling`）由 [`@deepseek-ai/dsh-tool-skill`](../tool-skill) 渲染到模型上下文中，表现为目录摘要和已加载的 `<skill_content>` 指令块。仅限用户调用的 skill（`disable-model-invocation: true`）在模型发现中保持隐藏，仅在用户显式触发斜杠命令调用时进入上下文。

#### Token effect

目录摘要增加的提示词 token 数量与已启用的允许模型调用 skill 的名称和描述成比例。已加载的 skill 正文仅在被选取或调用时消耗提示词 token。

#### KV Cache effect

该插件默认禁用，不会改变任何请求。启用后，目录摘要与已加载的 skill 正文会在各自插入点影响提供方的 KV 前缀。

## Known Limitations and Deferred Work

- 该提供方贡献固定的内置 skill 集合，不会监视外部目录进行运行时更新。
- 仅限用户调用的 skill 需要用户显式通过斜杠命令调用才能进入模型上下文。
