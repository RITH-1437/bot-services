import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeHtml, stripHtml } from "../src/utils/html";
import { buildMention, buildUsername, displayName } from "../src/utils/mention";
import { renderTemplate } from "../src/utils/template";

test("displayName joins first and last name", () => {
  assert.equal(displayName({ id: 1, first_name: "Ada", last_name: "Lovelace" }), "Ada Lovelace");
  assert.equal(displayName({ id: 1, first_name: "Ada" }), "Ada");
  assert.equal(displayName({ id: 1 }), "friend");
  assert.equal(displayName({ id: 1, first_name: "  " }), "friend");
});

test("username members are mentioned with @username", () => {
  const user = { id: 7, first_name: "Ada", username: "ada" };
  assert.equal(buildMention(user, "html"), "@ada");
  assert.equal(buildMention(user, "text"), "@ada");
  assert.equal(buildUsername(user), "@ada");
});

test("members without a username get a hidden-id HTML mention", () => {
  const user = { id: 555123, first_name: "Grace", last_name: "Hopper" };
  const mention = buildMention(user, "html");
  assert.match(mention, /^<a href="tg:\/\/user\?id=555123">/);
  assert.match(mention, />Grace Hopper<\/a>$/);
  // The numeric id must never be visible text.
  assert.doesNotMatch(mention.replace(/href="[^"]*"/, ""), /555123/);
  assert.equal(buildMention(user, "text"), "Grace Hopper");
  assert.equal(buildUsername(user), "");
});

test("names are HTML-escaped inside mentions and templates", () => {
  const user = { id: 9, first_name: "<script>alert(1)</script>" };
  const mention = buildMention(user, "html");
  assert.doesNotMatch(mention, /<script>/);
  assert.match(mention, /&lt;script&gt;/);

  const rendered = renderTemplate("Hi {{name}}", {
    mention: mention,
    name: escapeHtml(displayName(user)),
    username: "",
    group: "2Brothers Services",
    groupUsername: "",
  });
  assert.doesNotMatch(rendered, /<script>/);
});

test("template renders every supported placeholder", () => {
  const rendered = renderTemplate("{{mention}}|{{name}}|{{username}}|{{group}}|{{groupUsername}}", {
    mention: "@ada",
    name: "Ada Lovelace",
    username: "@ada",
    group: "2Brothers Services",
    groupUsername: "@twbrothers",
  });
  assert.equal(rendered, "@ada|Ada Lovelace|@ada|2Brothers Services|@twbrothers");
});

test("template tolerates whitespace inside placeholders and empty values", () => {
  const rendered = renderTemplate("Hi {{ name }}, welcome to {{group}}! {{username}}", {
    mention: "@ada",
    name: "Ada",
    username: "",
    group: "Test Group",
    groupUsername: "",
  });
  assert.equal(rendered, "Hi Ada, welcome to Test Group! ");
});

test("template reports unknown placeholders and keeps them visible", () => {
  const unknown: string[] = [];
  const rendered = renderTemplate(
    "Hello {{name}} {{nickname}}",
    { mention: "@a", name: "Ada", username: "@a", group: "G", groupUsername: "" },
    (name) => unknown.push(name),
  );
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0], "nickname");
  assert.match(rendered, /\{\{nickname\}\}/);
});

test("stripHtml produces a readable plain-text fallback", () => {
  const html = '👋 Welcome <a href="tg://user?id=42">Grace Hopper</a> to 2Brothers!<br>Second line';
  assert.equal(stripHtml(html), "👋 Welcome Grace Hopper to 2Brothers!\nSecond line");
});
