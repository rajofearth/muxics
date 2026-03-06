/* Pre-generate visualizer bar data to prevent flickering on re-renders */
export const VISUALIZER_DATA = Array.from({ length: 120 }).map(() => ({
  delay: Math.random() * -2,
  duration: 0.5 + Math.random() * 0.8,
  height: 20 + Math.random() * 80,
}));
