import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "muse",
		identifier: "muse.electrobun.dev",
		version: "1.0.0",
	},
	build: {
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: true,
		},
	},
} satisfies ElectrobunConfig;
