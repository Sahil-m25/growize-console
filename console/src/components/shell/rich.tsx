/* =================================================================================================
   The prototype's help copy is authored with two inline tags in it — <b> and <i> — and printed
   through innerHTML (HELP[…].p, HELP[…].b[], FAQ[].a). The port forbids dangerouslySetInnerHTML,
   and the strings must stay byte-identical, so the emphasis is parsed into elements instead.

   Nothing else is interpreted: an unknown tag is left as literal text, which is the safe failure —
   worst case the reader sees the tag rather than the page rendering somebody's markup.
   ============================================================================================== */

import { Fragment, type ReactNode } from "react";

const TAG = /<(\/?)([bi])>/g;

export function rich(s: string): ReactNode {
  if (!s || s.indexOf("<") < 0) return s;

  type Frame = { tag: "b" | "i" | null; kids: ReactNode[] };
  const stack: Frame[] = [{ tag: null, kids: [] }];
  let last = 0;
  let key = 0;

  const push = (n: ReactNode) => {
    stack[stack.length - 1]!.kids.push(n);
  };

  TAG.lastIndex = 0;
  for (let m = TAG.exec(s); m !== null; m = TAG.exec(s)) {
    if (m.index > last) push(s.slice(last, m.index));
    last = m.index + m[0].length;
    const close = m[1] === "/";
    const tag = m[2] as "b" | "i";
    if (!close) {
      stack.push({ tag, kids: [] });
    } else {
      const top = stack[stack.length - 1]!;
      if (top.tag !== tag || stack.length === 1) {
        /* an unbalanced tag is copy, not markup — print it as written */
        push(m[0]);
        continue;
      }
      stack.pop();
      const k = `r${key++}`;
      push(tag === "b" ? <b key={k}>{top.kids}</b> : <i key={k}>{top.kids}</i>);
    }
  }
  if (last < s.length) push(s.slice(last));

  /* any tag left open is closed here, in order, so nothing is dropped */
  while (stack.length > 1) {
    const top = stack.pop()!;
    const k = `r${key++}`;
    stack[stack.length - 1]!.kids.push(
      top.tag === "b" ? <b key={k}>{top.kids}</b> : <i key={k}>{top.kids}</i>,
    );
  }

  const kids = stack[0]!.kids;
  return <Fragment>{kids}</Fragment>;
}
