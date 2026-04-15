import { createContext, useContext, useEffect, useMemo } from "react";
import {
  TOMAS_THEME_ID,
  WEATHER_VARIANTS,
  getResolvedThemeVars,
  getThemeById,
  applyThemeVars
} from "./lib/themes.js";

const ThemeContext = createContext({
  themeId: "default",
  theme: getThemeById("default"),
  weatherState: "clear"
});

export function ThemeProvider({ themeId = "default", weatherState = "clear", children }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const theme = getThemeById(themeId);
    applyThemeVars(getResolvedThemeVars(theme));
    document.documentElement.style.colorScheme = theme.colorScheme || "dark";
    if (themeId === TOMAS_THEME_ID) {
      const variant = WEATHER_VARIANTS[weatherState] || WEATHER_VARIANTS.clear;
      if (variant?.vars) applyThemeVars(variant.vars);
      document.documentElement.dataset.weather = weatherState;
    } else {
      delete document.documentElement.dataset.weather;
    }
  }, [themeId, weatherState]);

  const value = useMemo(() => {
    return {
      themeId,
      theme: getThemeById(themeId),
      weatherState
    };
  }, [themeId, weatherState]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
