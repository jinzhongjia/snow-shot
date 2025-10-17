export enum VideoRecordState {
	Idle,
	Recording,
	Paused,
}

export const getVideoRecordParams = () => {
	const urlParams = new URLSearchParams(window.location.search);

	const selectRect = {
		min_x: parseInt(urlParams.get("select_rect_min_x") ?? "0", 10),
		min_y: parseInt(urlParams.get("select_rect_min_y") ?? "0", 10),
		max_x: parseInt(urlParams.get("select_rect_max_x") ?? "0", 10),
		max_y: parseInt(urlParams.get("select_rect_max_y") ?? "0", 10),
	};

	return {
		selectRect,
	};
};
