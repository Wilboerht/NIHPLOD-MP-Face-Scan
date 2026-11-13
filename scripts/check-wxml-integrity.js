/* WXML 静态完整性检查：U+FFFD、<view> 开闭数量、常见未闭合标签 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "pages");
let failed = false;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".wxml")) check(full);
  }
}

function check(file) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(path.resolve(__dirname, ".."), file);
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const opens = (text.match(/<view\b/g) || []).length;
  const closes = (text.match(/<\/view>/g) || []).length;

  if (replacementCount > 0) {
    console.error(`${rel}: contains ${replacementCount} U+FFFD replacement character(s)`);
    failed = true;
  }
  if (opens !== closes) {
    console.error(`${rel}: <view> open/close mismatch (${opens}/${closes})`);
    failed = true;
  }
}

walk(root);
if (failed) process.exit(1);
console.log("WXML integrity OK");
