import assert from "node:assert/strict";
import test from "node:test";
import { asHtml, mentioned, wrapped } from "../examples/web/src/app/writing.ts";

test("pressing bold wraps what is selected and keeps it selected", () => {
  assert.deepEqual(wrapped({ text: "hola mundo", from: 5, to: 10 }, "bold"), {
    text: "hola **mundo**",
    from: 7,
    to: 12
  });
});

test("pressing bold with nothing selected opens a pair and puts the cursor inside", () => {
  assert.deepEqual(wrapped({ text: "hola ", from: 5, to: 5 }, "bold"), {
    text: "hola ****",
    from: 7,
    to: 7
  });
});

test("each style has its own marks", () => {
  const said = { text: "algo", from: 0, to: 4 };
  assert.equal(wrapped(said, "italic").text, "_algo_");
  assert.equal(wrapped(said, "code").text, "`algo`");
  assert.equal(wrapped(said, "link").text, "[algo]()");
});

test("a link leaves the cursor where the address goes", () => {
  assert.deepEqual(wrapped({ text: "aquí", from: 0, to: 4 }, "link"), {
    text: "[aquí]()",
    from: 7,
    to: 7
  });
});

test("plain talk has no other way of being said", () => {
  assert.equal(asHtml("nada que marcar"), undefined);
});

test("the marks become the tags they stand for", () => {
  assert.equal(asHtml("**fuerte**"), "<strong>fuerte</strong>");
  assert.equal(asHtml("_flojo_"), "<em>flojo</em>");
  assert.equal(asHtml("`código`"), "<code>código</code>");
  assert.equal(asHtml("[aquí](https://deitu.example)"), '<a href="https://deitu.example">aquí</a>');
});

test("what somebody writes is never markup, however hard they try", () => {
  assert.equal(asHtml("**<img onerror=alert(1)>**"), "<strong>&lt;img onerror=alert(1)&gt;</strong>");
  assert.equal(asHtml('**"eso"**'), "<strong>&quot;eso&quot;</strong>");
});

test("a link that is not a link to anywhere is left as the text it is", () => {
  assert.equal(asHtml("[pulsa](javascript:alert(1))"), undefined);
  assert.equal(
    asHtml("**a** [pulsa](javascript:alert(1))"),
    "<strong>a</strong> [pulsa](javascript:alert(1))"
  );
});

test("who a message names is read off what it says", () => {
  assert.deepEqual(mentioned("aviso a @ana:deitu.example y a @bob:deitu.example"), [
    "@ana:deitu.example",
    "@bob:deitu.example"
  ]);
  assert.deepEqual(mentioned("sin nadie"), []);
  assert.deepEqual(mentioned("@ana:deitu.example y otra vez @ana:deitu.example"), ["@ana:deitu.example"]);
});
