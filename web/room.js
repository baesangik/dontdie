// 픽셀 방 렌더러. 192×120 논리 픽셀을 캔버스에 그리고 CSS로 확대한다.
// 포즈: outside | idle | looking | listening | thinking | talking | dozing

const W = 192;
const H = 120;

const C = {
  outline: "#4a3a33",
  body: "#fff7ea",
  bodyShade: "#f1e2cc",
  cheek: "#f5a3a3",
  eye: "#2b2220",
  wall: "#f3e3c3",
  wallStripe: "#ecd6ae",
  baseboard: "#b98a5a",
  floor: "#c99260",
  floorLine: "#ad7a4c",
  rug: "#e7a6a1",
  rugEdge: "#cf7f79",
  frame: "#8a5a3c",
  desk: "#9b6a43",
  deskDark: "#7b5233",
  monitor: "#3a3f4b",
  screen: "#8fd3ff",
  pot: "#c46a4a",
  leaf: "#5aa25a",
  leafDark: "#3f7f45",
  futon: "#9fc3e8",
  futonDark: "#7fa6cf",
  pillow: "#ffffff",
  shelf: "#a87650",
  book1: "#e0675f",
  book2: "#6c9bd2",
  book3: "#f2c35b",
  // 바깥
  night: "#1b2140",
  night2: "#252c52",
  houseWall: "#5d5068",
  houseDark: "#4a3f55",
  door: "#3d3146",
  doorFrame: "#2c2333",
  lamp: "#2a2a33",
  light: "rgba(255, 226, 140, 0.18)",
  bulb: "#ffe28c",
  ground: "#2a2836",
  rain: "rgba(180, 200, 255, 0.55)",
  star: "#f7f3d0",
};

function skyFor(hour) {
  if (hour < 5 || hour >= 21) return ["#1f2a4d", "#2c3a66"];
  if (hour < 7) return ["#f0b38a", "#9fb8e0"];
  if (hour < 17) return ["#8fd0f2", "#bfe6f7"];
  if (hour < 19) return ["#f29f6b", "#f7cf8a"];
  return ["#5a4f8a", "#e58b7a"];
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** 타원을 픽셀 줄 단위로 채운다. */
function blob(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.5))));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
  }
}

function drawCritter(ctx, x, y, o) {
  const s = o.small ? 0.8 : 1;
  const rx = Math.round(10 * s);
  const ry = Math.round(8 * s);
  const by = y + (o.bob ? 1 : 0);
  // 새싹
  rect(ctx, x, by - ry - 4, 1, 3, C.leafDark);
  rect(ctx, x - 2, by - ry - 5, 2, 1, C.leaf);
  rect(ctx, x + 1, by - ry - 6, 2, 1, C.leaf);
  // 발
  rect(ctx, x - 6, by + ry, 4, 2, C.outline);
  rect(ctx, x + 3, by + ry, 4, 2, C.outline);
  // 몸
  blob(ctx, x, by, rx + 1, ry + 1, C.outline);
  blob(ctx, x, by, rx, ry, C.body);
  rect(ctx, x - rx + 2, by + ry - 2, rx * 2 - 3, 1, C.bodyShade);
  // 눈
  const gaze = { front: [0, 0], left: [-2, 0], right: [2, 0], up: [1, -2], down: [0, 1] }[o.eyes] ?? [0, 0];
  const ex = x + gaze[0];
  const ey = by - 1 + gaze[1];
  if (o.eyes === "closed") {
    rect(ctx, ex - 5, ey + 1, 3, 1, C.eye);
    rect(ctx, ex + 3, ey + 1, 3, 1, C.eye);
  } else if (o.eyes === "happy") {
    rect(ctx, ex - 5, ey + 1, 1, 1, C.eye); rect(ctx, ex - 4, ey, 1, 1, C.eye); rect(ctx, ex - 3, ey + 1, 1, 1, C.eye);
    rect(ctx, ex + 3, ey + 1, 1, 1, C.eye); rect(ctx, ex + 4, ey, 1, 1, C.eye); rect(ctx, ex + 5, ey + 1, 1, 1, C.eye);
  } else if (o.blink) {
    rect(ctx, ex - 5, ey + 1, 2, 1, C.eye);
    rect(ctx, ex + 4, ey + 1, 2, 1, C.eye);
  } else {
    const tall = o.wide ? 4 : 3;
    rect(ctx, ex - 5, ey - (tall - 3), 2, tall, C.eye);
    rect(ctx, ex + 4, ey - (tall - 3), 2, tall, C.eye);
    rect(ctx, ex - 5, ey - (tall - 3), 1, 1, "#ffffff");
    rect(ctx, ex + 4, ey - (tall - 3), 1, 1, "#ffffff");
  }
  // 볼
  rect(ctx, x - 8, by + 3, 2, 1, C.cheek);
  rect(ctx, x + 7, by + 3, 2, 1, C.cheek);
  // 입
  if (o.mouth) rect(ctx, x, by + 3, 2, 2, C.eye);
  else rect(ctx, x, by + 3, 2, 1, C.eye);
}

function thoughtCloud(ctx, x, y, frame) {
  rect(ctx, x - 6, y + 6, 2, 2, "#ffffff");
  rect(ctx, x - 3, y + 2, 3, 3, "#ffffff");
  blob(ctx, x + 8, y - 4, 10, 5, C.outline);
  blob(ctx, x + 8, y - 4, 9, 4, "#ffffff");
  for (let i = 0; i < 3; i++) if (frame % 4 > i) rect(ctx, x + 3 + i * 4, y - 4, 2, 2, C.outline);
}

function bang(ctx, x, y) {
  rect(ctx, x, y, 2, 5, "#e0675f");
  rect(ctx, x, y + 6, 2, 2, "#e0675f");
}

function zzz(ctx, x, y, frame) {
  const k = frame % 6;
  ctx.fillStyle = "#6c7fb0";
  ctx.font = "6px monospace";
  ctx.fillText("z", x, y - k);
  if (k > 2) ctx.fillText("z", x + 4, y - 4 - k);
}

function drawRoom(ctx, t, hour) {
  // 벽
  rect(ctx, 0, 0, W, 84, C.wall);
  for (let x = 4; x < W; x += 12) rect(ctx, x, 0, 4, 84, C.wallStripe);
  rect(ctx, 0, 82, W, 3, C.baseboard);
  // 바닥
  rect(ctx, 0, 85, W, H - 85, C.floor);
  for (let y = 89; y < H; y += 6) rect(ctx, 0, y, W, 1, C.floorLine);
  for (let y = 85, row = 0; y < H; y += 6, row++) for (let x = (row % 2) * 16; x < W; x += 32) rect(ctx, x, y, 1, 6, C.floorLine);
  // 창문
  const [skyTop, skyBottom] = skyFor(hour);
  rect(ctx, 20, 14, 44, 34, C.frame);
  rect(ctx, 23, 17, 38, 14, skyTop);
  rect(ctx, 23, 31, 38, 14, skyBottom);
  rect(ctx, 41, 17, 2, 28, C.frame);
  rect(ctx, 23, 30, 38, 2, C.frame);
  if (hour < 6 || hour >= 20) { rect(ctx, 50, 20, 4, 4, "#fff6c8"); rect(ctx, 52, 20, 2, 2, skyTop); }
  else rect(ctx, 27, 21, 5, 5, "#fff2a8");
  rect(ctx, 18, 48, 48, 3, C.frame);
  // 책장
  rect(ctx, 150, 30, 30, 52, C.shelf);
  for (const sy of [44, 60]) rect(ctx, 150, sy, 30, 2, C.deskDark);
  for (const [bx, top, bw, bottom, color] of [
    [153, 34, 3, 44, C.book1], [157, 33, 3, 44, C.book2], [161, 35, 3, 44, C.book3], [165, 37, 4, 44, C.book2],
    [154, 49, 3, 60, C.book2], [158, 48, 3, 60, C.book1], [163, 50, 3, 60, C.book3],
    [154, 66, 3, 82, C.book3], [158, 65, 3, 82, C.book1], [168, 72, 9, 82, "#d9c9a8"],
  ]) rect(ctx, bx, top, bw, bottom - top, color);
  // 책상 + 모니터
  rect(ctx, 96, 60, 40, 4, C.desk);
  rect(ctx, 98, 64, 3, 20, C.deskDark);
  rect(ctx, 131, 64, 3, 20, C.deskDark);
  rect(ctx, 104, 44, 22, 15, C.monitor);
  rect(ctx, 106, 46, 18, 11, C.screen);
  if (Math.floor(t / 900) % 2) rect(ctx, 108, 48, 8, 1, "#ffffff");
  rect(ctx, 113, 59, 4, 2, C.monitor);
  // 화분
  rect(ctx, 76, 72, 10, 10, C.pot);
  rect(ctx, 75, 72, 12, 2, "#a8573b");
  rect(ctx, 80, 60, 2, 12, C.leafDark);
  blob(ctx, 78, 62, 3, 2, C.leaf);
  blob(ctx, 84, 65, 3, 2, C.leaf);
  blob(ctx, 81, 58, 2, 2, C.leaf);
  // 이불
  rect(ctx, 6, 94, 44, 14, C.futonDark);
  rect(ctx, 6, 92, 44, 12, C.futon);
  rect(ctx, 8, 90, 12, 6, C.pillow);
  // 러그
  blob(ctx, 104, 101, 34, 9, C.rugEdge);
  blob(ctx, 104, 101, 31, 7, C.rug);
}

function drawOutside(ctx, t) {
  rect(ctx, 0, 0, W, H, C.night);
  rect(ctx, 0, 0, W, 30, C.night2);
  for (const [sx, sy] of [[12, 8], [40, 18], [70, 6], [150, 12], [176, 22], [120, 4]]) if ((Math.floor(t / 700) + sx) % 5) rect(ctx, sx, sy, 1, 1, C.star);
  // 집 벽과 현관
  rect(ctx, 60, 24, 132, 76, C.houseWall);
  rect(ctx, 60, 24, 132, 4, C.houseDark);
  rect(ctx, 150, 40, 22, 16, "#ffd98a");
  rect(ctx, 160, 40, 2, 16, C.houseDark);
  rect(ctx, 150, 47, 22, 2, C.houseDark);
  rect(ctx, 96, 48, 30, 52, C.doorFrame);
  rect(ctx, 99, 51, 24, 49, C.door);
  rect(ctx, 118, 74, 2, 3, C.bulb);
  rect(ctx, 92, 98, 38, 4, "#6e6478");
  // 가로등
  rect(ctx, 30, 30, 3, 70, C.lamp);
  rect(ctx, 28, 28, 12, 3, C.lamp);
  rect(ctx, 36, 31, 4, 3, C.bulb);
  ctx.fillStyle = C.light;
  ctx.beginPath();
  ctx.moveTo(36, 33); ctx.lineTo(64, 102); ctx.lineTo(10, 102); ctx.closePath(); ctx.fill();
  // 땅
  rect(ctx, 0, 100, W, H - 100, C.ground);
  // 비
  for (let i = 0; i < 28; i++) {
    const rx = (i * 37 + Math.floor(t / 16) * 3) % W;
    const ry = (i * 53 + Math.floor(t / 16) * 7) % H;
    rect(ctx, rx, ry, 1, 3, C.rain);
  }
}

export function createRoom(canvas) {
  const ctx = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;

  let pose = "outside";
  let bangUntil = 0;
  let gaze = "front";
  let nextGazeAt = 0;
  let nextBlinkAt = 0;
  let blinkUntil = 0;
  let x = 104;
  let targetX = 104;
  let nextWanderAt = 0;
  let raf = 0;

  function frame(t) {
    const hour = new Date().getHours();
    const f = Math.floor(t / 180);
    if (pose === "outside") {
      drawOutside(ctx, t);
      drawCritter(ctx, 86, 92, { eyes: "down", bob: false, small: true, blink: t < blinkUntil });
    } else {
      drawRoom(ctx, t, hour);
      // 가만히 있을 때는 가끔 두리번거리고 조금씩 움직인다.
      if (pose === "idle") {
        if (t > nextGazeAt) {
          gaze = ["front", "left", "right", "up", "front", "down"][Math.floor(Math.random() * 6)];
          nextGazeAt = t + 1500 + Math.random() * 3500;
        }
        if (t > nextWanderAt) {
          targetX = 84 + Math.random() * 40;
          nextWanderAt = t + 6000 + Math.random() * 9000;
        }
      } else {
        gaze = { looking: "front", listening: "front", thinking: "up", talking: "front", dozing: "front" }[pose] ?? "front";
        if (pose !== "dozing") targetX = Math.abs(targetX - 104) > 10 ? 104 : targetX;
      }
      if (Math.abs(targetX - x) > 0.5) x += Math.sign(targetX - x) * 0.25;
      const walking = Math.abs(targetX - x) > 0.5;
      if (t > nextBlinkAt) { blinkUntil = t + 140; nextBlinkAt = t + 2500 + Math.random() * 3500; }
      const cy = 95;
      drawCritter(ctx, x, cy, {
        eyes: pose === "dozing" ? "closed" : walking ? (targetX < x ? "left" : "right") : gaze,
        bob: pose === "dozing" ? f % 6 < 3 : walking ? f % 2 === 0 : pose === "idle" && f % 8 < 4,
        blink: t < blinkUntil && pose !== "dozing",
        wide: pose === "looking" || pose === "listening",
        mouth: pose === "talking" && f % 2 === 0,
      });
      if (pose === "thinking") thoughtCloud(ctx, x + 10, cy - 18, f);
      if (pose === "dozing") zzz(ctx, x + 10, cy - 12, f);
      if (pose === "listening") { for (let i = 0; i < 3; i++) if (f % 4 > i) rect(ctx, x + 12 + i * 3, cy - 12, 2, 2, C.outline); }
      if (t < bangUntil) bang(ctx, x - 1, cy - 26);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setPose(next) {
      if (next === pose) return;
      if ((pose === "idle" || pose === "dozing") && (next === "looking" || next === "listening")) bangUntil = performance.now() + 1100;
      pose = next;
    },
    get pose() { return pose; },
    stop() { cancelAnimationFrame(raf); },
  };
}
