/*
 * 小程序静态完整性检查：
 * - JS 语法（node --check）
 * - JSON 可解析
 * - WXML 标签配对、U+FFFD、事件处理函数是否存在
 * - WXSS 变量引用是否已定义
 * - app.json 页面四件套是否齐全
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const IGNORES = new Set([".git", "node_modules", "dist"]);
const errors = [];
const counts = { js: 0, json: 0, wxml: 0, wxss: 0 };

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

function rel(file) {
  return path.relative(ROOT, file);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function checkJs(file) {
  counts.js += 1;
  checkTextEncoding(file);
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    errors.push(`${rel(file)}: JS syntax error\n${stderr.trim()}`);
  }
}

function checkJson(file) {
  counts.json += 1;
  checkTextEncoding(file);
  try {
    JSON.parse(read(file));
  } catch (err) {
    errors.push(`${rel(file)}: invalid JSON (${err.message})`);
  }
}

function checkTextEncoding(file) {
  const content = read(file);
  if (content.charCodeAt(0) === 0xfeff) errors.push(`${rel(file)}: contains UTF-8 BOM`);
  const count = (content.match(/\uFFFD/g) || []).length;
  if (count > 0) errors.push(`${rel(file)}: contains ${count} U+FFFD replacement character(s)`);
  return content;
}

function checkWxml(file) {
  counts.wxml += 1;
  const raw = checkTextEncoding(file);
  const content = raw.replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let match;
  while ((match = tagRe.exec(content))) {
    const closing = match[1] === "/";
    const tag = match[2];
    const selfClosing = match[4] === "/";
    if (selfClosing) continue;
    if (!closing) {
      stack.push(tag);
    } else if (stack.length === 0) {
      errors.push(`${rel(file)}: unmatched closing </${tag}>`);
    } else {
      const open = stack.pop();
      if (open !== tag) errors.push(`${rel(file)}: expected </${open}> but found </${tag}>`);
    }
  }
  if (stack.length) errors.push(`${rel(file)}: unclosed tag(s): ${stack.join(", ")}`);

  const pageDir = path.dirname(file);
  const pageName = path.basename(file, ".wxml");
  const jsPath = path.join(pageDir, pageName + ".js");
  if (!fs.existsSync(jsPath)) return;
  const js = read(jsPath);
  const handlerRe = /\b(?:bind|catch|capture-bind|capture-catch)[:\-]?[a-zA-Z]+\s*=\s*"([^"]+)"/g;
  let handler;
  while ((handler = handlerRe.exec(content))) {
    const name = handler[1].trim();
    if (!name || name.indexOf("{{") !== -1) continue;
    const methodRe = new RegExp(
      "(^|[\\s,{])" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*function\\b"
    );
    if (!methodRe.test(js)) {
      errors.push(`${rel(file)}: event handler "${name}" not found in ${path.basename(jsPath)}`);
    }
  }
}

const cssVars = new Set();
function collectWxssVars(file) {
  counts.wxss += 1;
  const content = checkTextEncoding(file);
  for (const match of content.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) cssVars.add(match[1]);
}

function checkWxssRefs(file) {
  const content = read(file);
  for (const match of content.matchAll(/var\(--([a-zA-Z0-9-]+)\)/g)) {
    if (!cssVars.has(match[1])) {
      errors.push(`${rel(file)}: undefined CSS variable --${match[1]}`);
    }
  }
}

function checkPages() {
  const appJson = JSON.parse(read(path.join(ROOT, "app.json")));
  for (const page of appJson.pages || []) {
    for (const ext of [".js", ".json", ".wxml", ".wxss"]) {
      const file = path.join(ROOT, page + ext);
      if (!fs.existsSync(file)) errors.push(`app.json page missing file: ${page}${ext}`);
    }
  }
}

const jsFiles = [];
const jsonFiles = [];
const wxmlFiles = [];
const wxssFiles = [];
walk(ROOT, (file) => {
  if (file.endsWith(".js")) jsFiles.push(file);
  else if (file.endsWith(".json")) jsonFiles.push(file);
  else if (file.endsWith(".wxml")) wxmlFiles.push(file);
  else if (file.endsWith(".wxss")) wxssFiles.push(file);
  else if (/\.(md|wxs)$/.test(file)) checkTextEncoding(file);
});

jsFiles.forEach(checkJs);
jsonFiles.forEach(checkJson);
wxmlFiles.forEach(checkWxml);
wxssFiles.forEach(collectWxssVars);
wxssFiles.forEach(checkWxssRefs);
checkTextEncoding(path.join(ROOT, "app.json"));
checkPages();

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\nProject integrity failed: ${errors.length} issue(s)`);
  process.exit(1);
}

console.log(
  `Project integrity OK (js=${counts.js}, json=${counts.json}, wxml=${counts.wxml}, wxss=${counts.wxss})`
);
