# 更新日志

[English](CHANGELOG.md)。这里记录已发布和待发布的变更，实际发布状态以
[GitHub Releases](https://github.com/JilongSun/mabrid/releases) 为准。

## 未发布

## 0.2.1

### 问题修复

- 聚合 Gateway 的 MCP 初始化现在报告已安装的 Mabrid 版本，不再固定为 `0.1.0`。
- Streamable HTTP 与 SSE 使用相同的有效身份；透传端点保留上游服务的名称、版本和指令。
- README 版本徽章跟随最新已发布的 Release，单独显示 `main` 的 CI 状态；开发者预览说明不再写死版本号。
- 发布流程读取根目录双语更新日志中对应版本的内容；没有记录时回退到 GitHub 自动摘要。重跑不会修改已有的公开 Release。

与 0.2.0 相比，没有配置格式变化、新增 Agent 能力或可信部署边界调整。

## 0.2.0

### 主要更新

- 可在 Gateway Settings 中管理已支持的 MCP 上游、端点和绑定；在 Host Settings 中配置 Hermes、原生 Session 和只写 API key。
- 保存配置与应用配置分离。Gateway 应用影响新建的桥接 Session；Host 应用要求没有进行中的 Host 操作，也没有活跃或未结清的 Run。
- 通过版本 PR 准备产品版本；匹配版本标签触发 CI，检查通过后发布 GitHub Release。

### 配置

- 静态进程设置保留在 `mabrid.yaml`，拓扑和 Agent Host 设置放在运行时文件中。
  新建部署使用 `runtime/mabrid.runtime.yaml`，通过 `runtimeConfigFile` 选择；未指定路径时仍默认使用静态配置旁的运行时文件。
- 运行时文件是配置权威来源。SQLite 保存已应用的 Gateway 修订和 Session 历史，不再作为第二个可编辑配置源；已有桥接 Session 保留其绑定的修订。
- Host 密钥通过 Host Settings 或 `agentHost.runtime.apiKey` 设置。旧字段 `apiKeyEnv` 会被拒绝，`.env` 不能提供或覆盖 Host 密钥。
- 静态进程设置仍需重启生效。Stdio 命令、参数、工作目录和环境变量仍通过文件管理。

项目仍处于开发者预览阶段，不保证配置格式兼容或数据库升级兼容。升级前请备份配置和数据，不应自动删除已有存储。

### 部署边界

管理接口仍无身份认证，仅用于可信部署。运行时文件及其备份含明文凭据，需要访问保护。
本版本未强化 MCP App 网络隔离，也不会自动重试工具调用或 Agent Run。

GitHub 提供标签对应的源码归档，尚不自动发布 OCI 镜像。