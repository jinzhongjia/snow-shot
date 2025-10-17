import { invoke } from "@tauri-apps/api/core";
import type { CaptureState } from "@/types/commands/global_state";

export const setCaptureState = async (capturing: boolean) => {
	const result = await invoke<void>("set_capture_state", { capturing });
	return result;
};

export const getCaptureState = async () => {
	const result = await invoke<CaptureState>("get_capture_state");
	return result;
};
