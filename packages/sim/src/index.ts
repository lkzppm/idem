/**
 * `@idem/sim`: deterministic discrete-event simulator for IDEM. Runs the real `@idem/core`
 * forwarder over virtual links (delay, loss, bandwidth) with a seeded workload.
 *
 * @packageDocumentation
 */

export {
  buildTopology,
  defaultConfig,
  type SimConfig,
  type SimLinkConfig,
  type SimMode,
  type SimNode,
  type SyntheticWorkload,
  type TopologyPreset,
  type TraceRecord,
  type TraceWorkload,
} from "./config";
export type {
  MicrobenchCell,
  MicrobenchData,
  MissOverhead,
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
export {
  type AttackRecord,
  type CallRecord,
  planWorkload,
  runSimulation,
  SIM_PRODUCER,
  type SimHooks,
  type SimResult,
  Simulation,
  type Transmission,
} from "./simulation";
