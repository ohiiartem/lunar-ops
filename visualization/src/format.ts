// Numbers shown to the user: whole numbers stay whole, others are rounded to one decimal place (63.5, 3.5, 12).
// Exceptions that keep more digits on purpose: site latitude/longitude (4 decimals, they identify the point).
export function num(value: number) {
  return String(parseFloat(value.toFixed(1))) // parseFloat drops a trailing ".0" and the sign of "-0.0"
}
