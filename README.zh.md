# Mabrid

[English](README.md) | [简体中文](README.zh.md)

[![Version](https://img.shields.io/badge/Version-v0.0.1-4C1?logo=semver&logoColor=white)](https://github.com/JilongSun/mabrid/releases/tag/v0.0.1)
[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](./backend/pyproject.toml)
[![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](./Dockerfile)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?logo=apache&logoColor=white)](./LICENSE)

Mabrid 是面向企业、个人开发者和 Agent 使用者的自部署 MCP 网关，
同时提供可选的 Agent Host，以会话（Session）为核心，面向不同的 Agent 运行时。

MCP 网关让你集中管理外部 MCP 服务器。Agent Host 为开发者提供现成的网页聊天界面，
用于接入和测试以对话为入口的 AI Agent 和大模型应用，而不必为了测试专门开发前端。

在网关和 Agent Host 的基础上，Mabrid 还可扩展更多功能，例如交互式 MCP Apps。

> [!NOTE]
> v0.1 为开发者预览版，功能仍在开发和优化中。
> Mabrid 的 API 尚未稳定，后续版本可能发生变更。

## Why Mabrid

### MCP Gateway

将外部 MCP 服务器汇集到统一的端点，通过命名空间区分不同服务器的工具，
并集中查看服务器配置、连接状态和桥接会话。网关在会话内保留工具和资源元数据，
用于路由处理；不缓存工具执行结果和资源内容。

![网关拓扑：一个聚合端点连接两个 MCP 服务器](docs/images/gateway-topology.png)

### 跨 Agent、以会话为核心的 Agent Host

通过适配器对接不同的 Agent 运行时，以会话组织测试过程。
在同一个界面中查看对话历史、流式回复、工具输入与结果，以及执行状态，
方便跟踪每次测试中发生了什么。接入采用非侵入式设计，
Agent 的执行逻辑、对话历史和上下文仍由原有运行时管理。

![Agent Host 会话：查看工具调用参数、执行结果和耗时](docs/images/agent-host-session.png)

### 易于扩展

网关和 Agent Host 为额外功能提供基础。通过事件广播和观察者模式，
扩展功能可以接收运行过程中的事件，而不必将功能逻辑写进协议桥接或 Agent 运行时。
MCP Apps 就是一个例子：它基于工具执行过程，在结果旁展示交互界面。

![MCP App：使用模拟数据展示用户查询结果](docs/images/mcp-apps.png)

目前的 Agent 集成通过 HTTP/SSE 连接独立部署的 Hermes 运行时。
Mabrid 容器本身不包含 Hermes。

## 快速开始

### 环境要求

- **本地开发：** Git、Python 3.12+、[uv](https://docs.astral.sh/uv/)、
  Node.js 22.12+ 和 pnpm 11.9.0。
- **Docker 部署：** Git 和 Docker，包含 Compose 2.30+，支持 Linux 容器。

以下命令默认使用 Make；跨平台使用可选择 [just](https://just.systems)，
每条命令均附有对应的 just 写法。

### 获取代码与配置

```sh
git clone https://github.com/JilongSun/mabrid.git
cd mabrid
make setup # 或：just setup
```

编辑生成的 `mabrid.yaml`，填入你的 MCP 服务器地址。示例中的地址需要替换。
如需启用 Agent Host，还需配置 Agent 运行时连接。

API Key 写在 `mabrid.yaml` 同目录的 `.env` 文件中，例如：

```dotenv
API_SERVER_KEY=your-api-key
```

`mabrid.yaml` 中的 `apiKeyEnv` 填写对应的环境变量名，而不是密钥本身。
不要将 `.env` 提交到版本控制中。

### 本地运行

```sh
make install # 或：just install
make dev     # 或：just dev
```

在浏览器中打开 <http://localhost:5173>，后端监听 8765 端口。

如需单独启动后端或前端，进入对应目录，运行 `make install`（或 `just install`），
再运行 `make dev`（或 `just dev`）。

### Docker 部署

```sh
make build # 或：just build
make run   # 或：just run
```

在浏览器中打开 <http://127.0.0.1:8765>。
运行 `make stop`（或 `just stop`）可停止容器，数据会保留在 Docker 卷中。

更多部署选项见[容器运行指南](docs/deployment/container.md)（英文）。

## 使用前须知

Mabrid 正在准备 **v0.1 开发者预览版**，适合在可信环境中自行部署和试用，
不适合作为面向公众的多用户服务。

- 请仅在可信网络中使用。管理 API 尚无身份验证，会话诊断信息可能包含工具输入和结果。
- 网页界面只支持查看网关配置。MCP 服务器和端点配置会在首次启动时导入空数据库，
  之后修改 YAML 不会更新数据库中已有的配置。
- MCP Apps 支持展示和交换工具数据。v0.1 不支持由 App 发起后续消息或工具调用。
- 桌面客户端和多 worker 部署不在 v0.1 范围内。

## 许可证

[Apache License 2.0](LICENSE)。
