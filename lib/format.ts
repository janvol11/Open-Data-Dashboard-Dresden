// Achsenwerte: "1,2 Mio." bei großen Zahlen, Nachkommastellen bei kleinen (0,25)
const AXIS_TICK_FORMAT = new Intl.NumberFormat("de-DE", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatAxisTick(value: number): string {
  return AXIS_TICK_FORMAT.format(value);
}
