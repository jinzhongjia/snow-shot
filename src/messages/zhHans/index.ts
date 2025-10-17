import { about } from "./about";
import { common } from "./common";
import { draw } from "./draw";
import { fullScreenDraw } from "./fullScreenDraw";
import { home } from "./home";
import { menu } from "./menu";
import { personalization } from "./personalization";
import { plugin } from "./plugin";
import { settings } from "./settings";
import { tools } from "./tools";
import { videoRecord } from "./videoRecord";

export const zhHans = {
	...menu,
	...settings,
	...home,
	...draw,
	...tools,
	...common,
	...fullScreenDraw,
	...about,
	...videoRecord,
	...plugin,
	...personalization,
};
