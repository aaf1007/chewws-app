/* global output */
// Today on the simulator (the Mac's clock and zone), as the app writes a date: "2 Nov 2026"
// (formatDate in src/ui/day-picker.tsx). The flow reads it as ${output.today}.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const now = new Date();
output.today = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
