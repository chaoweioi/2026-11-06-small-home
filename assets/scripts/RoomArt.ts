import { _decorator, Component, Graphics, UITransform, Color } from 'cc';
const { ccclass, property } = _decorator;

/** 墙纸花纹 */
export type WallPattern = 'none' | 'dots' | 'checks' | 'stripes';

/** 墙上挂的装饰（注意：不能长得像家具，否则孩子会以为那件东西可以摆） */
export type WallAccent = 'none' | 'bunting' | 'shelf' | 'chart';

/** 窗的样式：四间房各一种轮廓，一眼就能认出换了房间 */
export type WindowStyle = 'classic' | 'wide' | 'round' | 'narrow';

/** 一套房间配色。改色只需改这里，家具和判定都不动。 */
export interface RoomTheme {
    name: string;
    wall: string;        // 墙面
    floor: string;       // 地板
    plank: string;       // 木纹
    base: string;        // 地脚线 / 窗台
    glass: string;       // 窗玻璃
    pattern?: WallPattern;
    wainscot?: string;   // 护墙板（墙面下半截更深一号的颜色）
    window?: WindowStyle;
    accents?: WallAccent[];
}

export const ROOM_THEMES: RoomTheme[] = [
    {
        name: '小卧室', wall: '#D9EDF8', floor: '#F7E3C6', plank: '#966E46', base: '#F1D7B4',
        glass: '#CFE9F6', pattern: 'dots', window: 'classic',
    },
    {
        name: '客厅', wall: '#FBE7D2', floor: '#F2DCBE', plank: '#8C5E38', base: '#E7C49C',
        glass: '#D8ECF7', pattern: 'checks', wainscot: '#EFCFAD', window: 'wide',
    },
    {
        name: '儿童房', wall: '#E4F3E2', floor: '#F4E6C8', plank: '#7E6A45', base: '#E9D9B0',
        glass: '#D6EEF5', window: 'round', accents: ['bunting', 'chart'],
    },
    {
        name: '书房', wall: '#E9E4F6', floor: '#E8D6C0', plank: '#7A5A44', base: '#DCC7AE',
        glass: '#DCEAF6', pattern: 'stripes', wainscot: '#DDD6F0', window: 'narrow', accents: ['shelf'],
    },
];

function col(hex: string, a = 255): Color {
    const n = parseInt(hex.slice(1), 16);
    return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

/**
 * 《小小布置家》—— 房间背景：墙纸 / 护墙板 / 墙饰 / 窗 / 地板
 *
 * 挂在 Room 节点上。父节点自己的图形永远先于子节点渲染，所以家具一定在它上面。
 * 全部用 Graphics 画，不占一张图片；换房间只是换一组颜色 + 花纹。
 */
@ccclass('RoomArt')
export class RoomArt extends Component {
    @property({ tooltip: '墙面占几行格子' })
    wallRows = 6;

    @property({ tooltip: '一格多少像素' })
    cell = 40;

    @property({ tooltip: '配色序号，见 ROOM_THEMES' })
    theme = 0;

    onLoad() {
        this.paint(this.theme);
    }

    /** 换一套配色重画（关卡切换时调） */
    paint(theme: number) {
        this.theme = theme;
        const t = ROOM_THEMES[Math.max(0, Math.min(theme, ROOM_THEMES.length - 1))];

        const ut = this.getComponent(UITransform)!;
        const W = ut.width;
        const H = ut.height;
        const g = this.getComponent(Graphics) || this.addComponent(Graphics)!;

        const r = 20;                                   // 圆角
        const seam = H / 2 - this.wallRows * this.cell; // 墙和地板的分界线

        g.clear();

        // ---- 墙面：只磨上面两个角 ----
        g.fillColor = col(t.wall);
        g.moveTo(-W / 2, seam);
        g.lineTo(-W / 2, H / 2 - r);
        g.quadraticCurveTo(-W / 2, H / 2, -W / 2 + r, H / 2);
        g.lineTo(W / 2 - r, H / 2);
        g.quadraticCurveTo(W / 2, H / 2, W / 2, H / 2 - r);
        g.lineTo(W / 2, seam);
        g.close();
        g.fill();

        // ---- 墙纸花纹（画在墙中间一块，不去碰磨圆的角） ----
        this.drawPattern(g, t.pattern, W, seam, H / 2 - 26);

        // ---- 护墙板：墙下半截更深一号，顶端一条白线 ----
        if (t.wainscot) {
            const wh = 66;
            g.fillColor = col(t.wainscot);
            g.rect(-W / 2, seam, W, wh);
            g.fill();

            g.fillColor = new Color(255, 253, 248, 235);
            g.rect(-W / 2, seam + wh - 4, W, 4);
            g.fill();
        }

        // ---- 墙饰 ----
        for (const a of t.accents || []) {
            if (a === 'bunting') this.drawBunting(g, W, H);
            if (a === 'shelf') this.drawShelf(g, W, H);
            if (a === 'chart') this.drawChart(g, W, H);
        }

        // ---- 窗 ----
        this.drawWindow(g, t, W, H);

        // ---- 地板：只磨下面两个角 ----
        g.fillColor = col(t.floor);
        g.moveTo(-W / 2, seam);
        g.lineTo(W / 2, seam);
        g.lineTo(W / 2, -H / 2 + r);
        g.quadraticCurveTo(W / 2, -H / 2, W / 2 - r, -H / 2);
        g.lineTo(-W / 2 + r, -H / 2);
        g.quadraticCurveTo(-W / 2, -H / 2, -W / 2, -H / 2 + r);
        g.close();
        g.fill();

        // ---- 木纹横线 ----
        g.lineWidth = 1.5;
        g.strokeColor = col(t.plank, 40);
        for (let y = seam - this.cell; y > -H / 2 + 18; y -= this.cell) {
            g.moveTo(-W / 2 + 8, y);
            g.lineTo(W / 2 - 8, y);
        }
        g.stroke();

        // ---- 地脚线（压在墙和地板交界，最后画） ----
        g.fillColor = col(t.base);
        g.rect(-W / 2, seam - 3, W, 6);
        g.fill();
    }

    // ---------------- 墙纸 ----------------

    private drawPattern(g: Graphics, p: WallPattern | undefined, W: number, y0: number, y1: number) {
        if (!p || p === 'none') return;

        const top = y1;
        const bottom = y0 + 6;

        if (p === 'dots') {
            g.fillColor = new Color(120, 150, 175, 26);
            const step = 46;
            let row = 0;
            for (let y = top; y > bottom; y -= step, row++) {
                const off = row % 2 === 0 ? 0 : step / 2;
                for (let x = -W / 2 + 24 + off; x < W / 2 - 16; x += step) {
                    g.circle(x, y, 3.5);
                }
            }
            g.fill();
            return;
        }

        if (p === 'checks') {
            g.lineWidth = 1.5;
            g.strokeColor = new Color(190, 140, 100, 30);
            for (let x = -W / 2 + 20; x < W / 2 - 10; x += 46) {
                g.moveTo(x, bottom);
                g.lineTo(x, top);
            }
            for (let y = bottom + 20; y < top; y += 46) {
                g.moveTo(-W / 2 + 4, y);
                g.lineTo(W / 2 - 4, y);
            }
            g.stroke();
            return;
        }

        // stripes
        g.fillColor = new Color(120, 110, 165, 20);
        for (let x = -W / 2 + 14; x < W / 2 - 10; x += 56) {
            g.rect(x, bottom, 14, top - bottom);
        }
        g.fill();
    }

    // ---------------- 窗 ----------------

    private drawWindow(g: Graphics, t: RoomTheme, W: number, H: number) {
        const seam = H / 2 - this.wallRows * this.cell;
        switch (t.window) {
            case 'wide':   this.winWide(g, t, W, H, seam); break;
            case 'round':  this.winRound(g, t, W, H); break;
            case 'narrow': this.winNarrow(g, t, W, H, seam); break;
            default:       this.winClassic(g, t, W, H); break;
        }
    }

    /** 窗台：比窗宽出一圈，底下一道浅影 */
    private sill(g: Graphics, t: RoomTheme, x: number, y: number, w: number) {
        g.fillColor = col(t.base);
        g.roundRect(x - 12, y - 16, w + 24, 16, 5);
        g.fill();
        g.fillColor = new Color(0, 0, 0, 16);
        g.rect(x - 12, y - 18, w + 24, 4);
        g.fill();
    }

    /** 一朵云：三团圆的组合 */
    private cloud(g: Graphics, x: number, y: number, s: number) {
        g.fillColor = new Color(255, 255, 255, 235);
        g.circle(x, y, 9 * s);
        g.fill();
        g.circle(x + 12 * s, y - 6 * s, 11 * s);
        g.fill();
        g.circle(x + 25 * s, y, 8 * s);
        g.fill();
    }

    /** 小卧室：方窗 + 十字窗棂 */
    private winClassic(g: Graphics, t: RoomTheme, W: number, H: number) {
        const ww = 144;
        const wh = 132;
        const wx = -W / 2 + 44;
        const wy = H / 2 - 44;

        this.sill(g, t, wx, wy - wh, ww);

        g.fillColor = new Color(255, 255, 255, 255);
        g.roundRect(wx, wy - wh, ww, wh, 10);
        g.fill();

        g.fillColor = col(t.glass);
        g.roundRect(wx + 7, wy - wh + 7, ww - 14, wh - 14, 5);
        g.fill();

        g.fillColor = new Color(255, 255, 255, 255);
        g.rect(wx + ww / 2 - 3.5, wy - wh + 7, 7, wh - 14);
        g.fill();
        g.rect(wx + 7, wy - wh / 2 - 3.5, ww - 14, 7);
        g.fill();

        this.cloud(g, wx + 26, wy - 40, 1);
        this.cloud(g, wx + 92, wy - 34, 0.8);
    }

    /** 客厅：落地窗，从地面一直顶到墙顶 */
    private winWide(g: Graphics, t: RoomTheme, W: number, H: number, seam: number) {
        const x = -W / 2 + 38;
        const w = 300;
        const yb = seam + 8;
        const yt = H / 2 - 40;

        g.fillColor = new Color(255, 255, 255, 255);
        g.roundRect(x, yb, w, yt - yb, 12);
        g.fill();

        g.fillColor = col(t.glass);
        g.roundRect(x + 9, yb + 9, w - 18, yt - yb - 18, 7);
        g.fill();

        // 两根竖棂，把窗分成三扇
        g.fillColor = new Color(255, 255, 255, 255);
        g.rect(x + w / 3 - 4, yb + 9, 8, yt - yb - 18);
        g.fill();
        g.rect(x + (w * 2) / 3 - 4, yb + 9, 8, yt - yb - 18);
        g.fill();

        // 顶上一道横梁
        g.rect(x + 9, yt - 26, w - 18, 7);
        g.fill();

        this.cloud(g, x + 44, yt - 74, 1.15);
        this.cloud(g, x + 150, yt - 60, 0.85);
        this.cloud(g, x + 236, yt - 92, 1);
    }

    /** 儿童房：圆窗 + 十字窗棂 */
    private winRound(g: Graphics, t: RoomTheme, W: number, H: number) {
        const cx = -W / 2 + 122;
        const cy = H / 2 - 104;
        const r = 74;

        g.fillColor = new Color(255, 255, 255, 255);
        g.circle(cx, cy, r);
        g.fill();

        g.fillColor = col(t.glass);
        g.circle(cx, cy, r - 9);
        g.fill();

        g.fillColor = new Color(255, 255, 255, 255);
        g.rect(cx - 3.5, cy - (r - 18), 7, (r - 18) * 2);
        g.fill();
        g.rect(cx - (r - 18), cy - 3.5, (r - 18) * 2, 7);
        g.fill();

        this.cloud(g, cx - 46, cy + 22, 0.9);
    }

    /** 书房：高窄窗，四格竖排 */
    private winNarrow(g: Graphics, t: RoomTheme, W: number, H: number, seam: number) {
        const x = -W / 2 + 48;
        const w = 96;
        const yb = seam + 20;
        const yt = H / 2 - 46;

        this.sill(g, t, x, yb, w);

        g.fillColor = new Color(255, 255, 255, 255);
        g.roundRect(x, yb, w, yt - yb, 10);
        g.fill();

        g.fillColor = col(t.glass);
        g.roundRect(x + 7, yb + 7, w - 14, yt - yb - 14, 5);
        g.fill();

        g.fillColor = new Color(255, 255, 255, 255);
        const inner = yt - yb - 14;
        for (let i = 1; i <= 3; i++) {
            const yy = yb + 7 + (inner * i) / 4;
            g.rect(x + 7, yy - 3, w - 14, 6);
            g.fill();
        }

        this.cloud(g, x + 22, yt - 40, 0.75);
    }

    // ---------------- 墙饰 ----------------

    /** 一排三角彩旗，挂在墙顶靠右那一段（左边留给窗） */
    private drawBunting(g: Graphics, W: number, H: number) {
        const x0 = -W / 2 + 210;
        const x1 = W / 2 - 26;
        const yTop = H / 2 - 10;
        const sag = 26;
        const count = 9;
        const colors = ['#F6B8C9', '#F7D98C', '#A9DCC2', '#B9D7F2'];

        g.lineWidth = 2;
        g.strokeColor = new Color(214, 190, 168, 200);
        g.moveTo(x0, yTop);
        for (let i = 1; i <= 12; i++) {
            const u = i / 12;
            g.lineTo(x0 + (x1 - x0) * u, yTop - Math.sin(Math.PI * u) * sag);
        }
        g.stroke();

        for (let i = 0; i < count; i++) {
            const u = (i + 0.5) / count;
            const x = x0 + (x1 - x0) * u;
            const y = yTop - Math.sin(Math.PI * u) * sag;
            g.fillColor = col(colors[i % colors.length]);
            g.moveTo(x - 11, y);
            g.lineTo(x + 11, y);
            g.lineTo(x, y - 22);
            g.close();
            g.fill();
        }
    }

    /** 墙上的两层小书架（书房） */
    private drawShelf(g: Graphics, W: number, H: number) {
        const x0 = W / 2 - 268;
        const len = 176;
        const th = 9;
        const ys = [H / 2 - 92, H / 2 - 196];
        const books = ['#E8A0A8', '#F2C97B', '#9FD3B6', '#A9C4E8', '#D9A7D0'];

        for (let k = 0; k < ys.length; k++) {
            g.fillColor = new Color(216, 183, 140, 255);
            g.roundRect(x0, ys[k], len, th, 4);
            g.fill();

            const n = k === 0 ? 5 : 3;
            let bx = x0 + 12;
            for (let i = 0; i < n; i++) {
                const bh = 30 + ((i * 13 + k * 7) % 14);
                g.fillColor = col(books[(i + k) % books.length]);
                g.roundRect(bx, ys[k] + th, 13, bh, 3);
                g.fill();
                bx += 19;
            }
        }
    }

    /** 儿童房：身高尺 + 几颗小星星 */
    private drawChart(g: Graphics, W: number, H: number) {
        const cw = 36;
        const cx = W / 2 - 66;
        const yb = H / 2 - this.wallRows * this.cell + 16;   // 下沿，贴在地脚线上方
        const yt = H / 2 - 44;       // 上沿，和窗顶齐

        g.fillColor = new Color(255, 253, 248, 245);
        g.roundRect(cx - cw / 2, yb, cw, yt - yb, 9);
        g.fill();

        // 彩色分段
        const bands = ['#F6B8C9', '#F7D98C', '#A9DCC2', '#B9D7F2', '#F6B8C9', '#F7D98C'];
        for (let i = 0; i < bands.length; i++) {
            g.fillColor = col(bands[i]);
            g.roundRect(cx - cw / 2 + 3, yb + 8 + i * 28, cw - 6, 22, 4);
            g.fill();
        }

        // 刻度
        g.lineWidth = 1.5;
        g.strokeColor = new Color(180, 160, 140, 150);
        for (let y = yb + 10; y < yt - 8; y += 14) {
            g.moveTo(cx + cw / 2 - 12, y);
            g.lineTo(cx + cw / 2 - 4, y);
        }
        g.stroke();

        // 星星
        g.fillColor = new Color(247, 217, 140, 255);
        this.star(g, -W / 2 + 232, H / 2 - 96, 15);
        this.star(g, -W / 2 + 272, H / 2 - 132, 10);
        this.star(g, -W / 2 + 210, H / 2 - 152, 9);
        this.star(g, W / 2 - 150, H / 2 - 58, 11);
    }

    private star(g: Graphics, cx: number, cy: number, r: number) {
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const rr = i % 2 === 0 ? r : r * 0.46;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.close();
        g.fill();
    }
}
