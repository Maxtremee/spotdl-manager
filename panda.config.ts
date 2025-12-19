import { defineConfig } from "@pandacss/dev";
import { animationStyles } from "~/theme/animation-styles";
import { grass } from "~/theme/colors/grass";
import { green } from "~/theme/colors/green";
import { red } from "~/theme/colors/red";
import { slate } from "~/theme/colors/slate";
import { conditions } from "~/theme/conditions";
import { globalCss } from "~/theme/global-css";
import { keyframes } from "~/theme/keyframes";
import { layerStyles } from "~/theme/layer-styles";
import { recipes, slotRecipes } from "~/theme/recipes";
import { textStyles } from "~/theme/text-styles";
import { colors } from "~/theme/tokens/colors";
import { durations } from "~/theme/tokens/durations";
import { shadows } from "~/theme/tokens/shadows";
import { zIndex } from "~/theme/tokens/z-index";

export default defineConfig({
	// Whether to use css reset
	preflight: true,

	// Where to look for your css declarations
	include: ["./src/**/*.{js,jsx,ts,tsx}"],

	// Files to exclude
	exclude: [],

	// Useful for theme customization
	theme: {
		extend: {
			animationStyles: animationStyles,
			recipes: recipes,
			slotRecipes: slotRecipes,
			keyframes: keyframes,
			layerStyles: layerStyles,
			textStyles: textStyles,

			tokens: {
				colors: colors,
				durations: durations,
				zIndex: zIndex,
			},

			semanticTokens: {
				colors: {
					fg: {
						default: {
							value: {
								_light: "{colors.gray.12}",
								_dark: "{colors.gray.12}",
							},
						},

						muted: {
							value: {
								_light: "{colors.gray.11}",
								_dark: "{colors.gray.11}",
							},
						},

						subtle: {
							value: {
								_light: "{colors.gray.10}",
								_dark: "{colors.gray.10}",
							},
						},
					},

					border: {
						value: {
							_light: "{colors.gray.4}",
							_dark: "{colors.gray.4}",
						},
					},

					error: {
						value: {
							_light: "{colors.red.9}",
							_dark: "{colors.red.9}",
						},
					},

					grass: grass,
					gray: slate,
					red: red,
					green: green,
				},

				shadows: shadows,
			},
		},
	},

	plugins: [
		{
			name: "Remove Panda Preset Colors",
			hooks: {
				"preset:resolved": ({ utils, preset, name }) =>
					name === "@pandacss/preset-panda"
						? utils.omit(preset, [
								"theme.tokens.colors",
								"theme.semanticTokens.colors",
							])
						: preset,
			},
		},
	],

	// The output directory for your css system
	outdir: "styled-system",

	jsxFramework: "solid",

	globalCss: globalCss,
	conditions: conditions,
});
