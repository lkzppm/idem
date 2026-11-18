/**
 * `@idem/sim`: deterministic discrete-event simulator for IDEM. Runs the real `@idem/core`
 * forwarder over virtual links (delay, loss, bandwidth) with a seeded workload, on any graph of
 * agents, forwarders and producers (ADR-027).
 *
 * @packageDocumentation
 */

export {
  type AgentPlan,
  buildTopology,
  type Dist,
  defaultConfig,
  type PerAgentWorkload,
  SIM_PRODUCER,
  type SimConfig,
  type SimLinkConfig,
  type SimMode,
  type SimNode,
  type SimProducerConfig,
  type SimToolConfig,
  type SyntheticWorkload,
  type ToolId,
  type ToolMixEntry,
  type TopologyPreset,
  type TraceRecord,
  type TraceWorkload,
} from "./config";
export type {
  EmulationData,
  EmulationModeId,
  MicrobenchCell,
  MicrobenchData,
  MissOverhead,
  NfdData,
  NfdRunData,
  NfdScenario,
  ResultsData,
  RunRef,
  SafetyData,
  Stat,
  SweepData,
} from "./experiments/export";
export type { AttackClass, Expectation } from "./experiments/safety";
export type { EvalModeId, SweepBase } from "./experiments/spec";
export { type Metrics, MetricsCollector } from "./metrics";
export { assertProcessingCosts, costUs, type ProcessingCosts, type ProcessingOp } from "./processing";
export { percentile, Rng, Zipf } from "./rng";
export { pathToProducer, type RouteHop, type RoutePath, reachableProducers, routesTo } from "./routing";
export {
  type AttackRecord,
  type CallRecord,
  runSimulation,
  type SimCallError,
  type SimHooks,
  type SimResult,
  Simulation,
  type Transmission,
} from "./simulation";
export {
  CITIES,
  CORPUS_ORIGIN,
  isToolId,
  SEARCH_QUERIES,
  type SimToolContext,
  simTool,
  TOOL_CATALOG,
  TOOL_IDS,
  type ToolCatalogEntry,
  toolInfo,
} from "./tools";
export {
  DEFAULT_MAX_RESULT_BYTES,
  type ResolvedProducer,
  SimConfigError,
  type SimErrorCode,
  validateConfig,
} from "./validate";
export { AGENT_PLAN_DEFAULTS, type PlannedCall, planWorkload } from "./workload";
