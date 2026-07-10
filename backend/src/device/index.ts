/**
 * Device Module - Exportiert alle Device-Services.
 *
 * **Clean Architecture für Button+ Device-Interaktion:**
 *
 * - **DeviceManager**: Zentrale Orchestrierung
 * - **DeviceService**: MQTT-Publishing-API
 * - **SceneRenderer**: Scene-zu-Device-Mapping
 * - **AutomationRuntime**: Event-Handling & Logic
 * - **DeviceConfigBuilder**: Config-Generierung
 */

export { DeviceManager } from "./DeviceManager.js";
export { DeviceService } from "./DeviceService.js";
export { SceneRenderer } from "./SceneRenderer.js";
export { AutomationRuntime } from "./AutomationRuntime.js";
export { DeviceConfigBuilder } from "./DeviceConfigBuilder.js";

// Types
export type { DeviceConfig, DisplayItemUpdate, ButtonUpdate, LedUpdate } from "./DeviceService.js";
export type { DisplayMapping, SceneRenderConfig } from "./SceneRenderer.js";
export type { DeviceConfigInput, DeviceConfigOutput } from "./DeviceConfigBuilder.js";
export type { RuntimeState } from "./AutomationRuntime.js";
