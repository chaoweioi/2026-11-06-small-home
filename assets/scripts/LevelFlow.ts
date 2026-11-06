import { _decorator, Component, Node, UITransform, Graphics, Label, Color, tween, Vec3, Sprite, SpriteFrame, Texture2D, ImageAsset, RenderTexture, Camera, Layers, view, sys, UIOpacity, EventTouch } from 'cc';
import { ArtType, ITEMS, drawFurniture, FurnitureArt } from './FurnitureArt';
import { RoomGrid } from './RoomGrid';
import { RoomArt } from './RoomArt';
import { Drawer } from './Drawer';
import { LEVELS, LevelConfig, Goal, pickGoals, introOf } from './LevelData';
import { Sfx } from './Sfx';
const { ccclass, property } = _decorator;

const CHIP = 84;        // 目标格子边长
const CHIP_GAP = 14;
const ROOM_SCALE = 1.1;   // 房间整体放大，手机上东西才够大
const BAR_Y = 640 - 72;

/** 全部 18 件（自由模式全给，今日挑战从里面抽） */
const ALL_ITEMS: ArtType[] = [
    ArtType.Bed, ArtType.Cabinet, ArtType.Lamp, ArtType.Rug, ArtType.Plant, ArtType.Stool,
    ArtType.Poster, ArtType.Bear, ArtType.Sofa, ArtType.Shelf, ArtType.ToyBox, ArtType.Cat,
    ArtType.TV, ArtType.FloorLamp, ArtType.Pillow, ArtType.Clock, ArtType.Curtain, ArtType.FishTank,
];

/** 今日挑战的虚拟关卡：从 18 件里抽 5 件 */
const DAILY: LevelConfig = {
    name: '今日挑战',
    goalPool: ALL_ITEMS,
    goalCount: 5,
    available: ALL_ITEMS,
};

interface RoundCfg {
    goals: Goal[];
    available: ArtType[];
    room: number;
    kicker: string;
    title: string;
    intro: string;
}

interface Chip {
    node: Node;
    bg: Graphics;
    tick: Node;
    cnt: Label | null;
    type: ArtType;
    need: number;
    done: boolean;
}

/**
 * 《小小布置家》—— 关卡流程：目标条 / 达标判定 / 通关
 *
 * 挂在 Canvas 上（要覆盖全屏，所以不能挂在 Room 下面）。
 */
@ccclass('LevelFlow')
export class LevelFlow extends Component {
    @property({ type: Node, tooltip: '房间节点' })
    room: Node = null!;

    @property({ type: Drawer, tooltip: '底部抽屉' })
    drawer: Drawer = null!;

    @property({ tooltip: '从第几关开始（0 = 第一关）' })
    startLevel = 0;

    private _board: RoomGrid = null!;
    private _chips: Chip[] = [];
    private _goals: Goal[] = [];          // 本关实际要摆的东西（随机关由种子生成）
    private _seeds: Record<number, number> = {};
    /** 进关时那张"第 N 关 / 房间名 / 要干什么"的浮卡 */
    private _intro: Node | null = null;
    /** 顶部 UI 的 y：按屏幕实际可视高度算，长屏不会悬在半空 */
    private _barY = BAR_Y;
    /** 通关提示条的 y：跟着房间走 */
    private _bannerY = 430;
    /** 房间下方的小字提示 */
    private _hint: Label | null = null;
    private _bar: Node | null = null;
    private _banner: Node | null = null;
    private _mini: Node | null = null;
    private _shotBtn: Node | null = null;
    private _shooting = false;
    private _photo: Node | null = null;
    private _photoURL: string | null = null;
    /** 存图排查用：显示读回/size/路径那一行小字，正常出包保持 false */
    private static readonly DEBUG_SAVE = false;
    private _photoUri: string | null = null;
    private _photoBuf: ArrayBuffer | null = null;
    private _photoW = 0;
    private _photoH = 0;
    private _card: Node | null = null;
    private _btnRow: Node | null = null;
    private _saveBox: Node | null = null;
    private _saving = false;
    private _index = 0;
    private _pending = false;
    private _dismissed = false;
    private _mode: 'level' | 'daily' | 'free' = 'level';
    private _round: RoundCfg | null = null;
    private _modeBtn: Node | null = null;
    private _modePanel: Node | null = null;
    private _dailyDone = false;
    /** 已通过到第几关（1 表示第 1 关过了），只增不减 */
    private _cleared = 0;
    private _dailyStreak = 0;

    onLoad() {
        Sfx.init();
        Sfx.playBgm(0.3);       // 背景音乐比音效小声，先起个底
        // 按宽度适配后，19.5:9 的机器可视高度是 1560，不是设计稿的 1280。
        // 顶部 UI 要贴着"安全区"上沿走，否则会长在屏幕中间、或者被挖孔摄像头压住。
        const vis = view.getVisibleSize();
        this._barY = vis.height / 2 - 84 - LevelFlow.notchInset();
        this.drawBackdrop();
        // 房间背景没手动挂的话自动补上，少一步编辑器操作
        if (this.room && !this.room.getComponent(RoomArt)) this.room.addComponent(RoomArt);
        if (!this.room) { console.error('[LevelFlow] 没有指定 room'); return; }
        this._board = this.room.getComponent(RoomGrid)!;
        if (!this._board) { console.error('[LevelFlow] Room 上没有挂 RoomGrid'); return; }
        this._board.changed.on('changed', this.refresh, this);
        this.makeShotButton();
        this.loadDaily();
        this.makeModeButton();
    }

    /** 顶部被状态栏 / 挖孔摄像头吃掉多少（设计像素） */
    private static notchInset(): number {
        const vis = view.getVisibleSize();
        try {
            // 传 false 拿真实的上下边，不要对称化：对称会把底部的导航条也算到顶部
            const sa = sys.getSafeAreaRect(false);     // 单位已是 UI（设计）坐标，原点在可视区左下角
            const top = vis.height - (sa.y + sa.height);
            // 兜个底：就算系统没报安全区，也往下让 52，避开居中的挖孔摄像头
            return Math.max(52, Math.min(top, 200));
        } catch (e) {
            return 0;
        }
    }

    /** 放在 start 而不是 onLoad：要等 Drawer 的 onLoad 先跑完，否则抽屉会被建两遍 */
    start() {
        this._index = this.startLevel;
        this.loadProgress();
        this.startLevelAt(this._index);
    }

    /**
     * 排版面。**必须放在抽屉填完物品之后调**：
     * 抽屉 1 行还是 2 行高度不一样，位置跟着变，房间得按新高度重新居中。
     */
    private layout() {
        const halfH = view.getVisibleSize().height / 2;

        // 抽屉贴住可视区最下沿
        let drawerH = 200;
        if (this.drawer) {
            const dut = this.drawer.node.getComponent(UITransform);
            drawerH = dut ? dut.height : 200;
            this.drawer.node.setPosition(0, -halfH + drawerH / 2, 0);
        }

        const rut = this.room.getComponent(UITransform)!;
        const topLimit = this._barY - 42;                 // 目标条的下沿
        const bottomLimit = -halfH + drawerH;             // 抽屉的上沿
        const availH = Math.max(240, topLimit - bottomLimit);

        // 想放大到 1.1，但不能超出两条硬边界：宽度留 16px 边距、高度留一点空隙。
        // 短屏 + 两行大抽屉时这里会自动缩，房间不会压到抽屉上。
        const kW = (720 - 16) / rut.width;
        const kH = (availH - 20) / rut.height;
        const k = Math.max(0.55, Math.min(ROOM_SCALE, kW, kH));
        this.room.setScale(k, k, 1);
        const roomH = rut.height * k;

        const roomY = Math.round(Math.max(bottomLimit + roomH / 2, Math.min(topLimit - roomH / 2, (topLimit + bottomLimit) / 2)));
        this.room.setPosition(0, roomY, 0);

        // 提示条挂在房间上沿之上；挤不下就往上让
        this._bannerY = Math.min(roomY + roomH / 2 + 96, topLimit - 96);

        // 房间下面的小字提示（还差几件），顺便把那条空带填掉
        this.makeHint(roomY - roomH / 2 - 46);
    }

    onDestroy() {
        if (this._board) this._board.changed.off('changed', this.refresh, this);
    }

    private level(): LevelConfig {
        return LEVELS[Math.max(0, Math.min(this._index, LEVELS.length - 1))];
    }

    // ---------- 开局 ----------

    /** 全屏奶油底色：画在 Canvas 自己身上，比改相机清除色省事 */
    private drawBackdrop() {
        const g = this.getComponent(Graphics) || this.addComponent(Graphics)!;
        g.clear();
        g.fillColor = new Color(253, 246, 236, 255);
        // 画得比 720×1280 大：长屏手机（19.5:9）按宽度适配后，
        // 屏幕上下会比 1280 多出一截，画满才不会有深色条
        g.rect(-720, -1100, 1440, 2200);
        g.fill();
    }

    /** 固定关直接返回写好的清单；随机关按"本关种子"生成，同一局里来回切关也不会变 */
    private goalsFor(i: number): Goal[] {
        const lv = LEVELS[Math.max(0, Math.min(i, LEVELS.length - 1))];
        if (lv.goals && lv.goals.length) return lv.goals;
        let seed = this._seeds[i];
        if (seed === undefined) {
            seed = (Math.random() * 0x7fffffff) | 0;
            this._seeds[i] = seed;
        }
        return pickGoals(lv, seed);
    }

    private startLevelAt(i: number) {
        this._mode = 'level';
        this._index = Math.max(0, Math.min(i, LEVELS.length - 1));
        this.saveProgress();
        const lv = this.level();
        const goals = this.goalsFor(this._index);
        this.beginRound({
            goals,
            available: lv.available,
            room: lv.room ?? 0,
            kicker: `第 ${this._index + 1} 关`,
            title: lv.name,
            intro: introOf(lv, goals),
        });
    }

    /** 三种模式共用：换房间、清空、填抽屉、排版、建目标条、进关提示 */
    private beginRound(cfg: RoundCfg) {
        const art = this.room.getComponent(RoomArt);
        if (art) art.paint(cfg.room);

        this._dismissed = false;
        this._pending = false;
        this.unschedule(this.fireWin);
        this.hideDoneUI();
        this.hideIntroNow();
        this.closePhoto();
        this._chips = [];      // 先清空，避免清房间时"旧目标刚好达成"误触发通关

        this.clearRoom();
        this._round = cfg;
        this._goals = cfg.goals;
        if (this.drawer) this.drawer.setItems(cfg.available);
        this.layout();          // 抽屉行数定了，再排房间
        this.buildBar();
        this.refresh();
        this.showIntro();
    }

    // ---------- 进关提示 ----------

    /**
     * 进关时房间正中浮一张卡：第几关、这间屋子叫什么、这一关要干什么。
     * 两秒多自己淡出；玩家先放下第一件东西也会立刻收掉，不挡事。
     */
    private showIntro() {
        const r = this._round;
        if (!r) return;
        this.hideIntroNow();

        const c = new Node('intro');
        c.layer = this.node.layer;
        c.parent = this.node;
        c.setPosition(0, this.room.position.y, 0);
        c.addComponent(UITransform).setContentSize(560, 180);

        const g = c.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 255, 250);
        g.roundRect(-280, -90, 560, 180, 34);
        g.fill();
        g.lineWidth = 5;
        g.strokeColor = new Color(246, 214, 200, 255);
        g.roundRect(-280, -90, 560, 180, 34);
        g.stroke();

        this.label(c, r.kicker, 0, 58, 22, new Color(196, 169, 149, 255));
        this.label(c, r.title, 0, 18, 34, new Color(122, 92, 74, 255));
        this.label(c, r.intro, 0, -38, 23, new Color(168, 148, 132, 255));

        this._intro = c;

        const op = c.addComponent(UIOpacity);
        op.opacity = 0;
        tween(op).to(0.22, { opacity: 255 }).start();
        c.setScale(0.94, 0.94, 1);
        tween(c).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

        this.scheduleOnce(this.hideIntro, 2.9);
    }

    /** 到点或被玩家抢先：淡出再销毁 */
    private hideIntro() {
        this.unschedule(this.hideIntro);
        if (!this._intro) return;
        const n = this._intro;
        this._intro = null;
        const op = n.getComponent(UIOpacity);
        if (op) {
            tween(op).to(0.28, { opacity: 0 })
                .call(() => { if (n.isValid) n.destroy(); })
                .start();
        } else {
            n.destroy();
        }
    }

    /** 立刻抹掉，不给淡出（换关时用，避免旧卡残留） */
    private hideIntroNow() {
        this.unschedule(this.hideIntro);
        if (this._intro) { this._intro.destroy(); this._intro = null; }
    }

    /** 清空房间（只清游戏里生成的家具，相机/背景之类不动） */
    private clearRoom() {
        for (const c of this.room.children.slice()) {
            if (!c.getComponent(FurnitureArt)) continue;
            if (this._board) this._board.unregister(c);   // 先摘掉，免得判定时还算它占着格子
            c.destroy();
        }
    }

    // ---------- 顶部目标条 ----------

    private buildBar() {
        if (this._bar) { this._bar.destroy(); this._bar = null; }
        this._chips = [];

        const bar = new Node('goalbar');
        bar.layer = this.node.layer;
        bar.parent = this.node;
        bar.setPosition(0, this._barY, 0);
        this._bar = bar;

        const n = this._goals.length;
        // 目标多的时候相机按钮往下让一行，别压住最后一颗
        if (this._shotBtn) this._shotBtn.setPosition(300, n > 4 ? this._barY - 84 : this._barY, 0);
        const total = n * CHIP + (n - 1) * CHIP_GAP;
        let x = -total / 2 + CHIP / 2;

        for (const g of this._goals) {
            this._chips.push(this.makeChip(bar, g.type, g.count, x));
            x += CHIP + CHIP_GAP;
        }
    }

    private makeChip(bar: Node, type: ArtType, need: number, x: number): Chip {
        const chip = new Node('goal');
        chip.layer = bar.layer;
        chip.parent = bar;
        chip.setPosition(x, 0, 0);

        const ut = chip.addComponent(UITransform);
        ut.setContentSize(CHIP, CHIP);

        const bg = chip.addComponent(Graphics);
        const c: Chip = { node: chip, bg, tick: null!, cnt: null, type, need, done: false };
        this.paintChip(c);

        // 家具缩略图
        const spec = ITEMS[type];
        const box = CHIP - 30;
        const k = Math.min(box / spec.w, box / spec.h);
        const art = new Node('art');
        art.layer = chip.layer;
        art.parent = chip;
        art.setPosition(0, need > 1 ? 8 : 0, 0);   // 有数量的才往上让一点，否则正中
        drawFurniture(art.addComponent(Graphics), type, spec.w * k, spec.h * k);

        // 数量（只要不是 1 才显示）
        if (need > 1) {
            const lb = new Node('cnt');
            lb.layer = chip.layer;
            lb.parent = chip;
            lb.setPosition(0, -CHIP / 2 + 15, 0);
            const lut = lb.addComponent(UITransform);
            lut.setContentSize(CHIP, 24);
            const l = lb.addComponent(Label);
            l.string = `0/${need}`;
            l.fontSize = 18;
            l.lineHeight = 22;
            l.color = new Color(150, 130, 118, 255);
            l.horizontalAlign = Label.HorizontalAlign.CENTER;
            l.verticalAlign = Label.VerticalAlign.CENTER;
            c.cnt = l;
        }

        c.tick = this.makeTick(chip);
        return c;
    }

    private paintChip(c: Chip) {
        const g = c.bg;
        g.clear();
        g.fillColor = c.done ? new Color(224, 246, 230, 255) : new Color(255, 251, 244, 255);
        g.roundRect(-CHIP / 2, -CHIP / 2, CHIP, CHIP, 22);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = c.done ? new Color(122, 200, 152, 255) : new Color(238, 224, 208, 255);
        g.roundRect(-CHIP / 2, -CHIP / 2, CHIP, CHIP, 22);
        g.stroke();
    }

    /** 完成时右上角出现的绿色对勾 */
    private makeTick(chip: Node): Node {
        const n = new Node('tick');
        n.layer = chip.layer;
        n.parent = chip;
        n.setPosition(CHIP / 2 - 9, CHIP / 2 - 9, 0);

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(112, 200, 144, 255);
        g.circle(0, 0, 14);
        g.fill();
        g.lineWidth = 4.5;
        g.strokeColor = new Color(255, 255, 255, 255);
        g.moveTo(-6.5, 0.5);
        g.lineTo(-1.5, -5);
        g.lineTo(6.5, 4);
        g.stroke();

        n.active = false;
        return n;
    }

    // ---------- 判定 ----------

    private countAll(): Record<number, number> {
        const m: Record<number, number> = {};
        for (const it of this._board.items) {
            const fa = it.getComponent(FurnitureArt);
            if (fa) m[fa.artType] = (m[fa.artType] || 0) + 1;
        }
        return m;
    }

    private allDone(): boolean {
        const m = this.countAll();
        return this._chips.length > 0 && this._chips.every((c) => (m[c.type] || 0) >= c.need);
    }

    private refresh() {
        if (!this._board) return;

        const counts = this.countAll();

        // 一放下第一件东西就收起进关提示，别挡着玩家看房间
        let placed = 0;
        for (const k in counts) placed += counts[k];
        if (placed > 0) this.hideIntro();

        // 自由模式没有目标，底下那行字换成"随便摆"
        if (this._mode === 'free') {
            if (this._hint) {
                this._hint.node.active = true;
                this._hint.string = '想怎么摆就怎么摆～';
            }
            return;
        }

        if (!this._chips.length) return;

        let all = true;
        for (const c of this._chips) {
            const n = counts[c.type] || 0;
            const done = n >= c.need;
            if (done !== c.done) {
                c.done = done;
                this.paintChip(c);
                c.tick.active = done;
            }
            if (c.cnt) c.cnt.string = `${Math.min(n, c.need)}/${c.need}`;
            if (!done) all = false;
        }

        this.updateHint(counts, all);

        // 摆满了：等物品落稳（0.35 秒）在顶部浮出提示条；没摆满就收起来
        if (!all) {
            this.hideDoneUI();
            this._dismissed = false;
        } else if (!this._dismissed && !this._banner && !this._pending) {
            this._pending = true;
            this.scheduleOnce(this.fireWin, 0.35);
        }
    }

    private fireWin() {
        this._pending = false;
        if (this._dismissed || this._banner) return;
        if (this.allDone()) this.showBanner();
    }

    /** 房间底下那行小字：还差几件 / 都摆好啦 */
    private makeHint(y: number) {
        if (!this._hint) {
            const n = new Node('hint');
            n.layer = this.node.layer;
            n.parent = this.node;
            n.addComponent(UITransform).setContentSize(600, 40);
            const l = n.addComponent(Label);
            l.fontSize = 26;
            l.lineHeight = 26;
            l.color = new Color(168, 148, 132, 255);
            l.horizontalAlign = Label.HorizontalAlign.CENTER;
            l.verticalAlign = Label.VerticalAlign.CENTER;
            this._hint = l;
        }
        this._hint.node.setPosition(0, y, 0);
    }

    private updateHint(counts: Record<number, number>, all: boolean) {
        if (!this._hint) return;
        if (all) { this._hint.node.active = false; return; }
        let left = 0;
        for (const c of this._chips) left += Math.max(0, c.need - (counts[c.type] || 0));
        this._hint.node.active = true;
        this._hint.string = left > 0 ? `还差 ${left} 件` : '';
    }

    // ---------- 通关提示（浮在顶部，不挡操作） ----------

    /**
     * 摆满之后**不弹模态框**，只在顶部浮一条提示。
     * 孩子可能还想挪两下，弹窗一盖就什么都干不了了。
     */
    private showBanner() {
        if (this._banner) return;

        const b = new Node('done');
        b.layer = this.node.layer;
        b.parent = this.node;
        b.setPosition(0, this._bannerY, 0);
        b.addComponent(UITransform).setContentSize(620, 160);
        this._banner = b;

        const g = b.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 255, 248);
        g.roundRect(-310, -80, 620, 160, 34);
        g.fill();
        g.lineWidth = 5;
        g.strokeColor = new Color(246, 214, 200, 255);
        g.roundRect(-310, -80, 620, 160, 34);
        g.stroke();

        this.label(b, this._mode === 'daily' ? '今日挑战完成！' : '布置好啦！', 0, 48, 30, new Color(122, 92, 74, 255));

        this.pill(b, '再改改', -142, -26, 260, 76,
            new Color(255, 246, 234, 255), new Color(235, 217, 198, 255), new Color(122, 92, 74, 255),
            () => this.keepEditing());

        if (this._mode === 'daily') {
            this.pill(b, '去自由摆', 142, -26, 260, 76,
                new Color(126, 199, 155, 255), new Color(126, 199, 155, 255), new Color(255, 255, 255, 255),
                () => this.startFree());
        } else {
            this.pill(b, '下一关', 142, -26, 260, 76,
                new Color(126, 199, 155, 255), new Color(126, 199, 155, 255), new Color(255, 255, 255, 255),
                () => this.nextLevel());
        }

        b.setScale(0.9, 0.9, 1);
        tween(b).to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        Sfx.play('win');
        if (this._mode === 'daily') this.markDailyDone();
        else if (this._mode === 'level') this.markLevelCleared();
    }

    private hideBanner() {
        if (!this._banner) return;
        this._banner.destroy();
        this._banner = null;
    }

    /** 收起提示，继续摆。之后要是又没摆满再摆满，它会重新出现 */
    private keepEditing() {
        this._dismissed = true;
        this.hideBanner();
        this.showMiniNext();
    }

    private nextLevel() {
        this.hideDoneUI();
        this.startLevelAt((this._index + 1) % LEVELS.length);
    }

    // ---------- 收起后的「下一关」入口 ----------

    /** 「再改改」之后：提示条收成一颗小药丸，随时还能进下一关 */
    private showMiniNext() {
        if (this._mini) return;
        const p = this.pill(this.node, '布置好啦 · 下一关 ›', 0, this._bannerY, 380, 66,
            new Color(126, 199, 155, 255), new Color(126, 199, 155, 255), new Color(255, 255, 255, 255),
            () => this.nextLevel());
        p.setScale(0.86, 0.86, 1);
        tween(p).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        this._mini = p;
    }

    private hideMiniNext() {
        if (!this._mini) return;
        this._mini.destroy();
        this._mini = null;
    }

    private hideDoneUI() {
        this.hideBanner();
        this.hideMiniNext();
    }

    // ---------- 存图 ----------

    /** 右上角相机按钮，一直挂着，随时能拍 */
    private makeShotButton() {
        const n = new Node('shot');
        n.layer = this.node.layer;
        n.parent = this.node;
        n.setPosition(300, this._barY, 0);
        n.addComponent(UITransform).setContentSize(76, 76);

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 255, 235);
        g.roundRect(-38, -38, 76, 76, 24);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(238, 224, 208, 255);
        g.roundRect(-38, -38, 76, 76, 24);
        g.stroke();

        g.fillColor = new Color(122, 92, 74, 255);
        g.roundRect(-17, -13, 34, 24, 5);
        g.fill();
        g.roundRect(-7, 11, 14, 7, 4);
        g.fill();
        g.fillColor = new Color(255, 255, 255, 255);
        g.circle(0, -1, 6);
        g.fill();

        n.on(Node.EventType.TOUCH_END, () => this.snapshot(), this);
        this._shotBtn = n;
    }

    /**
     * 拍一张房间照片。
     *
     * 不能直接 canvas.toDataURL()：WebGL 上下文没开 preserveDrawingBuffer，截出来是黑的。
     * 所以临时加一台只渲染 UI_2D 的相机，targetTexture 指到一张 720×1280 的 RenderTexture 上，
     * 等它自己渲一帧再 readPixels。
     */
    private snapshot() {
        if (this._shooting) return;
        this._shooting = true;

        const btn = this._shotBtn;
        if (btn) {
            tween(btn).to(0.08, { scale: new Vec3(0.9, 0.9, 1) })
                .to(0.12, { scale: new Vec3(1, 1, 1) }).start();
        }

        const W = 720;
        const H = 1280;

        // 房间实际占的那块（Canvas 坐标 → RT 像素坐标），四周留 24
        const ut = this.room.getComponent(UITransform)!;
        const rp = this.room.position;
        const cw = Math.min(W, Math.round(ut.width + 48));
        const ch = Math.min(H, Math.round(ut.height + 48));
        const cx = Math.max(0, Math.min(W - cw, Math.round(rp.x + W / 2 - cw / 2)));
        const cy = Math.max(0, Math.min(H - ch, Math.round(rp.y + H / 2 - ch / 2)));

        const rt = new RenderTexture();
        rt.reset({ width: W, height: H });

        const n = new Node('shotCam');
        n.layer = Layers.Enum.UI_2D;
        n.parent = this.node;
        n.setPosition(0, 0, 1000);      // 正交相机默认在原点朝 -Z，必须退到 z=1000 才看得见 UI
        const cam = n.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = 640;
        cam.near = 1;
        cam.far = 2000;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        cam.clearColor = new Color(253, 246, 236, 255);
        cam.visibility = Layers.Enum.UI_2D;
        cam.targetTexture = rt;

        // 拍照时把界面藏起来，只留房间和小家具。
        // 注意用 UIOpacity 置 0，不要用 active=false：
        // 节点被关掉再打开后，里面的 Graphics 会整个画不出来（只剩 Label），这是引擎那边的坑。
        const hidden: { n: Node; op: UIOpacity; v: number }[] = [];
        const addHide = (x: Node | null) => {
            if (!x || !x.isValid) return;
            const op = x.getComponent(UIOpacity) || x.addComponent(UIOpacity);
            hidden.push({ n: x, op, v: op.opacity });
            op.opacity = 0;
        };
        addHide(this._bar);
        addHide(this._banner);
        addHide(this._mini);
        addHide(this._shotBtn);
        addHide(this._hint ? this._hint.node : null);
        if (this.drawer) addHide(this.drawer.node);

        this.scheduleOnce(() => {
            let err = '';
            let sf: SpriteFrame | null = null;
            let url: string | null = null;
            try {
                const buf = rt.readPixels(cx, cy, cw, ch);
                if (!buf || buf.length < cw * ch * 4) {
                    err = '没取到画面';
                } else {
                    // GL 的像素是自下往上的，翻过来再给图片用
                    const flipped = LevelFlow.flipY(buf, cw, ch);
                    this._photoBuf = flipped.buffer as ArrayBuffer;
                    this._photoW = cw;
                    this._photoH = ch;
                    sf = LevelFlow.makeSprite(flipped, cw, ch);
                    url = LevelFlow.toDataURL(flipped, cw, ch);
                }
            } catch (e: any) {
                err = String((e && e.message) || e);
            }

            n.destroy();
            for (const h of hidden) if (h.n.isValid) h.op.opacity = h.v;
            this._shooting = false;

            if (sf) this.showPhoto(sf, url, cw, ch);
            else this.toast(err ? `拍照失败：${err}` : '拍照失败');
        }, 0.15);
    }

    /** 屏幕中间冒一条小提示，1.6 秒后自己消失 */
    private toast(msg: string) {
        const n = new Node('toast');
        n.layer = this.node.layer;
        n.parent = this.node;
        n.setPosition(0, 0, 0);
        n.addComponent(UITransform).setContentSize(640, 80);

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(90, 70, 60, 215);
        g.roundRect(-300, -34, 600, 68, 34);
        g.fill();

        // 一个节点只能有一个渲染组件，文字要单独挂子节点
        const t = new Node('t');
        t.layer = n.layer;
        t.parent = n;
        t.addComponent(UITransform).setContentSize(600, 68);
        const l = t.addComponent(Label);
        l.string = msg;
        l.fontSize = 24;
        l.lineHeight = 24;
        l.color = new Color(255, 246, 236, 255);
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;

        n.setSiblingIndex(this.node.children.length - 1);
        tween(n).delay(1.4).to(0.25, { scale: new Vec3(0.9, 0.9, 1) }).call(() => { if (n.isValid) n.destroy(); }).start();
        console.warn('[LevelFlow] toast:', msg);
    }

    private static flipY(buf: Uint8Array, w: number, h: number): Uint8Array {
        const row = w * 4;
        const out = new Uint8Array(buf.length);
        for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
        return out;
    }

    private static makeSprite(buf: Uint8Array, w: number, h: number): SpriteFrame {
        const img = new ImageAsset({
            _data: buf,
            width: w,
            height: h,
            format: Texture2D.PixelFormat.RGBA8888,
            _compressed: false,
        });
        const tex = new Texture2D();
        tex.image = img;
        const sf = new SpriteFrame();
        sf.texture = tex;
        return sf;
    }

    /** 网页预览里可以靠它存成 PNG；抖音端要换成 tt.saveImageToPhotosAlbum */
    private static toDataURL(buf: Uint8Array, w: number, h: number): string | null {
        const doc: any = (globalThis as any).document;
        if (!doc) return null;
        const cv = doc.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const c2 = cv.getContext('2d');
        const data = c2.createImageData(w, h);
        data.data.set(buf);
        c2.putImageData(data, 0, 0);
        return cv.toDataURL('image/png');
    }

    private showPhoto(sf: SpriteFrame, dataURL: string | null, w: number, h: number) {
        this.closePhoto();

        const root = new Node('photo');
        root.layer = this.node.layer;
        root.parent = this.node;
        root.addComponent(UITransform).setContentSize(1440, 2200);
        root.on(Node.EventType.TOUCH_START, () => { /* 挡住下面的操作 */ }, this);
        this._photo = root;

        const dim = root.addComponent(Graphics);
        dim.fillColor = new Color(80, 60, 50, 150);
        dim.rect(-720, -1100, 1440, 2200);
        dim.fill();

        const card = new Node('card');
        card.layer = root.layer;
        card.parent = root;
        card.addComponent(UITransform).setContentSize(520, 760);
        const cg = card.addComponent(Graphics);
        cg.fillColor = new Color(255, 255, 255, 255);
        cg.roundRect(-260, -380, 520, 760, 40);
        cg.fill();

        this.label(card, '你的小房间', 0, 310, 30, new Color(122, 92, 74, 255));

        const pn = new Node('img');
        pn.layer = root.layer;
        pn.parent = card;
        pn.setPosition(0, 40, 0);
        const k = Math.min(460 / w, 430 / h);
        pn.addComponent(UITransform).setContentSize(Math.round(w * k), Math.round(h * k));
        const sp = pn.addComponent(Sprite);
        sp.spriteFrame = sf;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;

        // 两颗按钮放进一行，保存时整行收起来换成转圈
        const row = new Node('row');
        row.layer = root.layer;
        row.parent = card;
        row.addComponent(UITransform).setContentSize(520, 200);

        this.pill(row, '保存图片', 0, -240, 320, 88,
            new Color(126, 199, 155, 255), new Color(126, 199, 155, 255), new Color(255, 255, 255, 255),
            () => this.savePhoto());

        this.pill(row, '关掉', 0, -320, 200, 60,
            new Color(255, 246, 234, 255), new Color(235, 217, 198, 255), new Color(122, 92, 74, 255),
            () => this.closePhoto());

        this._card = card;
        this._btnRow = row;
        this._saving = false;
        this._photoURL = dataURL;

        card.setScale(0.9, 0.9, 1);
        tween(card).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    }

    private sharePhoto() {
        const jsb: any = (globalThis as any).jsb;
        if (!jsb || !this._photoUri) return;
        try {
            const r = jsb.reflection.callStaticMethod(
                'com/cocos/game/PhotoBridge', 'share',
                '(Ljava/lang/String;)Ljava/lang/String;', this._photoUri);
            if (r) this.toast('分享失败：' + String(r).slice(0, 20));
        } catch (e: any) {
            this.toast('分享失败');
        }
    }

    private closePhoto() {
        if (this._photo) {
            this._photo.destroy();
            this._photo = null;
        }
        this._photoURL = null;
        this._photoUri = null;
        this._card = null;
        this._btnRow = null;
        this._saveBox = null;
        this._saving = false;
    }

    private savePhoto() {
        if (this._saving) return;
        this._saving = true;
        this.showSavingUI();

        // 让转圈先画出来一帧，再去干正事
        this.scheduleOnce(() => {
            let ok = false;
            let why = '';
            let where = '';
            let diag = '';

            try {
                const doc: any = (globalThis as any).document;
                if (doc && this._photoURL) {
                    const a = doc.createElement('a');
                    a.download = `小小布置家-第${this._index + 1}关.png`;
                    a.href = this._photoURL;
                    a.click();
                    ok = true;
                    where = '电脑上';
                } else {
                    // 原生包没有 document，也没有 PNG 编码器：把裸像素丢给安卓端编码并写进相册
                    const jsb: any = (globalThis as any).jsb;
                    if (jsb && jsb.reflection && this._photoBuf) {
                        const tmp = jsb.fileUtils.getWritablePath() + 'xxbzj-photo.raw';
                        if (!jsb.fileUtils.writeDataToFile(this._photoBuf, tmp)) {
                            why = '临时文件写不进去';
                        } else {
                            // 文件名带时间戳：同名文件已存在时，MediaStore 会自动改名成「xxbzj-1 (1).png」，
                            // 我们拿到的路径和实际落盘的路径就对不上了。每次都不一样就没有这个问题。
                            const d = new Date();
                            const p2 = (n: number) => (n < 10 ? '0' + n : '' + n);
                            const stamp = `${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
                            const r = String(jsb.reflection.callStaticMethod(
                                'com/cocos/game/PhotoBridge', 'savePng',
                                '(Ljava/lang/String;IILjava/lang/String;)Ljava/lang/String;',
                                tmp, this._photoW, this._photoH,
                                `xxbzj-${this._index + 1}-${stamp}`) || '');
                            if (r.indexOf('OK|') === 0) {
                                ok = true;
                                where = '相册';
                                // 后面几段是现场信息（pend / size / 路径），临时显示出来方便排查
                                diag = r.split('|').slice(2).join(' · ');
                                this._photoUri = r.split('|')[1] || null;
                            } else {
                                why = r.replace(/^ERR\|/, '') || '未知原因';
                            }
                        }
                    } else {
                        why = '这个平台还不能存图';
                    }
                }
            } catch (e: any) {
                why = String((e && e.message) || e);
            }

            // 转圈至少亮 0.45 秒，否则一闪而过看着像没反应
            this.scheduleOnce(() => {
                this._saving = false;
                this.showSavedUI(ok, where, why, diag);
            }, 0.45);
        }, 0.05);
    }

    /** 保存中的转圈（就地替换掉那两颗按钮） */
    private showSavingUI() {
        if (!this._card) return;
        if (this._btnRow) this._btnRow.active = false;
        if (this._saveBox && this._saveBox.isValid) this._saveBox.destroy();

        const box = new Node('saving');
        box.layer = this._card.layer;
        box.parent = this._card;
        box.setPosition(0, -280, 0);
        box.addComponent(UITransform).setContentSize(520, 200);
        this._saveBox = box;

        const ring = new Node('ring');
        ring.layer = box.layer;
        ring.parent = box;
        ring.setPosition(0, 34, 0);
        ring.addComponent(UITransform).setContentSize(64, 64);
        const g = ring.addComponent(Graphics);
        g.lineWidth = 7;
        g.strokeColor = new Color(126, 199, 155, 255);
        g.arc(0, 0, 24, -Math.PI * 0.72, Math.PI * 0.72, true);
        g.stroke();
        tween(ring).by(0.85, { angle: -360 }).repeatForever().start();

        this.label(box, '正在保存…', 0, -30, 24, new Color(150, 130, 116, 255));
    }

    /** 保存结果：成功就倒计时自动关，失败停住等手动关 */
    private showSavedUI(ok: boolean, where: string, why: string, diag = '') {
        if (!this._card) return;
        if (this._saveBox && this._saveBox.isValid) this._saveBox.destroy();

        const box = new Node('saved');
        box.layer = this._card.layer;
        box.parent = this._card;
        box.setPosition(0, -258, 0);
        box.addComponent(UITransform).setContentSize(520, 216);
        this._saveBox = box;

        if (ok) {
            const ck = new Node('ck');
            ck.layer = box.layer;
            ck.parent = box;
            ck.setPosition(0, 62, 0);
            ck.addComponent(UITransform).setContentSize(56, 56);
            const g = ck.addComponent(Graphics);
            g.fillColor = new Color(126, 199, 155, 255);
            g.circle(0, 0, 26);
            g.fill();
            g.lineWidth = 6;
            g.strokeColor = new Color(255, 255, 255, 255);
            g.moveTo(-11, 1);
            g.lineTo(-3, -8);
            g.lineTo(12, 9);
            g.stroke();

            this.label(box, `已保存到${where}`, 0, 12, 28, new Color(122, 92, 74, 255));
            // 现场信息，临时的一行小字：相册不显示时靠它定位问题
            if (diag && LevelFlow.DEBUG_SAVE) this.label(box, diag, 0, -22, 15, new Color(196, 180, 166, 255));

            let wait = 2.0;
            if (this._photoUri) {
                // 相册万一还是不认，至少能把图直接发出去
                this.pill(box, '分享', 0, -66, 200, 58,
                    new Color(126, 199, 155, 255), new Color(126, 199, 155, 255), new Color(255, 255, 255, 255),
                    () => this.sharePhoto());
                wait = 5.0;
            } else {
                this.label(box, '2 秒后自动关闭', 0, -38, 22, new Color(168, 148, 132, 255));
            }

            // 整张卡都能点着关掉，不用非按按钮
            this._card!.on(Node.EventType.TOUCH_END, () => this.closePhoto(), this);
            this.scheduleOnce(() => this.closePhoto(), wait);
        } else {
            this.label(box, '保存没成功', 0, 50, 26, new Color(122, 92, 74, 255));
            const short = why.length > 16 ? why.slice(0, 16) + '…' : why;
            this.label(box, short || '不知道为啥', 0, 8, 20, new Color(168, 148, 132, 255));
            this.pill(box, '关掉', 0, -56, 180, 62,
                new Color(255, 246, 234, 255), new Color(235, 217, 198, 255), new Color(122, 92, 74, 255),
                () => this.closePhoto());
        }
    }

    // ---------- 模式：关卡 / 每日 / 自由 ----------

    private static readonly DAILY_KEY = 'xxbzj.daily.v1';
    /** 关卡进度：回到上次那关、已通过几关 */
    private static readonly PROG_KEY = 'xxbzj.progress.v1';

    /** 本地日期串，offset = -1 就是昨天 */
    private static todayKey(offset = 0): string {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        const m = d.getMonth() + 1;
        const day = d.getDate();
        // 不用 padStart：tsconfig 的 lib 是 es2015，没有它
        return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
    }

    private loadProgress() {
        try {
            const raw = sys.localStorage.getItem(LevelFlow.PROG_KEY);
            if (!raw) return;
            const o = JSON.parse(raw);
            if (o && typeof o.level === 'number') {
                this._index = Math.max(0, Math.min(o.level | 0, LEVELS.length - 1));
            }
            if (o && typeof o.cleared === 'number') {
                this._cleared = Math.max(0, Math.min(o.cleared | 0, LEVELS.length));
            }
        } catch (e) {
            // 存档读不出来就从第一关开始，不影响玩
        }
    }

    private saveProgress() {
        try {
            sys.localStorage.setItem(LevelFlow.PROG_KEY,
                JSON.stringify({ level: this._index, cleared: this._cleared }));
        } catch (e) {
            // 存不进去就算了
        }
    }

    /** 通过第 N 关：只记最大进度，重复通关不会往回退 */
    private markLevelCleared() {
        const done = this._index + 1;
        if (done > this._cleared) {
            this._cleared = done;
            this.saveProgress();
        }
    }

    private loadDaily() {
        try {
            const raw = sys.localStorage.getItem(LevelFlow.DAILY_KEY);
            if (!raw) return;
            const o = JSON.parse(raw);
            this._dailyStreak = (o && o.streak) | 0;
            this._dailyDone = !!o && o.last === LevelFlow.todayKey();
        } catch (e) {
            // 读不出来就当没做过，不影响玩
        }
    }

    private markDailyDone() {
        const today = LevelFlow.todayKey();
        let streak = 1;
        try {
            const raw = sys.localStorage.getItem(LevelFlow.DAILY_KEY);
            const o = raw ? JSON.parse(raw) : null;
            if (o && o.last === today) streak = o.streak | 0;
            else if (o && o.last === LevelFlow.todayKey(-1)) streak = (o.streak | 0) + 1;
            sys.localStorage.setItem(LevelFlow.DAILY_KEY, JSON.stringify({ last: today, streak }));
        } catch (e) {
            // 存不进去就算了，下次当第一天
        }
        this._dailyDone = true;
        this._dailyStreak = streak;
    }

    /** 今日挑战：种子取日期，同一天进来永远是同一组目标 */
    private startDaily() {
        const d = new Date();
        const day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        const seed = (day ^ 0x5bd1e995) >>> 0;
        const goals = pickGoals(DAILY, seed);

        this._mode = 'daily';
        this.beginRound({
            goals,
            available: DAILY.available,
            room: seed % 3,          // 0 卧室 / 1 客厅 / 2 儿童房，书房留给以后的关卡
            kicker: this._dailyDone ? '今天已经摆过一次' : (this._dailyStreak > 0 ? `连续 ${this._dailyStreak} 天` : '每天都有一组新目标'),
            title: '今日挑战',
            intro: `今天要摆 ${goals.length} 件，摆好就算过`,
        });
    }

    /** 自由模式：没有目标、全部给、随便摆 */
    private startFree() {
        this._mode = 'free';
        this.beginRound({
            goals: [],
            available: ALL_ITEMS,
            room: 0,
            kicker: '没有任务',
            title: '自由摆放',
            intro: '想怎么摆就怎么摆',
        });
    }

    /** 左上角那颗按钮：三个小圆点，点开选模式 */
    private makeModeButton() {
        const n = new Node('mode');
        n.layer = this.node.layer;
        n.parent = this.node;
        n.setPosition(-300, this._barY, 0);
        n.addComponent(UITransform).setContentSize(76, 76);

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 255, 235);
        g.roundRect(-38, -38, 76, 76, 24);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(238, 224, 208, 255);
        g.roundRect(-38, -38, 76, 76, 24);
        g.stroke();

        g.fillColor = new Color(150, 124, 104, 255);
        g.circle(-14, 0, 5);
        g.fill();
        g.circle(0, 0, 5);
        g.fill();
        g.circle(14, 0, 5);
        g.fill();

        // openModePanel 里自己会出点击音，这里不要再响一次
        n.on(Node.EventType.TOUCH_END, () => this.openModePanel(), this);
        this._modeBtn = n;
    }

    private openModePanel() {
        if (this._modePanel) {
            this.closeModePanel();
            return;
        }
        Sfx.play('click');

        const p = new Node('modepanel');
        p.layer = this.node.layer;
        p.parent = this.node;
        p.addComponent(UITransform).setContentSize(1440, 2200);
        this._modePanel = p;

        // 压暗 + 点空白处关掉
        const g = p.addComponent(Graphics);
        g.fillColor = new Color(58, 44, 34, 96);
        g.rect(-720, -1100, 1440, 2200);
        g.fill();
        p.on(Node.EventType.TOUCH_END, () => this.closeModePanel(), this);

        const cardW = 480;
        const rowH = 84;
        const gap = 14;

        // 卡片：三行
        const card = new Node('card');
        card.layer = p.layer;
        card.parent = p;
        // 88 = 顶部标题区；26 = 底部留白（不留的话最后一行会贴着卡片下沿）
        const cardH = rowH * 3 + gap * 2 + 88 + 26;
        card.addComponent(UITransform).setContentSize(cardW, cardH);
        const cg = card.addComponent(Graphics);
        cg.fillColor = new Color(255, 253, 248, 255);
        cg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 34);
        cg.fill();
        cg.lineWidth = 5;
        cg.strokeColor = new Color(246, 214, 200, 255);
        cg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 34);
        cg.stroke();

        this.label(card, '换个玩法', 0, cardH / 2 - 52, 30, new Color(122, 92, 74, 255));

        const idx = Math.max(0, Math.min(this._index, LEVELS.length - 1));
        const rows: { on: boolean; title: string; sub: string; act: () => void }[] = [
            {
                on: this._mode === 'level',
                title: '关卡模式',
                sub: this._cleared >= LEVELS.length
                    ? `${LEVELS.length} 关都过啦，可以再来一遍`
                    : `第 ${idx + 1} 关 · ${LEVELS[idx].name}`,
                act: () => this.startLevelAt(idx),
            },
            {
                on: this._mode === 'daily',
                title: '今日挑战',
                sub: this._dailyDone ? `今天已通过 · 连续 ${this._dailyStreak} 天` : '每天一组新目标',
                act: () => this.startDaily(),
            },
            {
                on: this._mode === 'free',
                title: '自由模式',
                sub: '没有目标，全部家具随便摆',
                act: () => this.startFree(),
            },
        ];

        let y = (cardH / 2 - 88) - rowH / 2;
        for (const r of rows) {
            this.modeRow(card, r.title, r.sub, y, cardW - 56, rowH, r.on, r.act);
            y -= rowH + gap;
        }

        card.setScale(0.92, 0.92, 1);
        tween(card).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    }

    private modeRow(parent: Node, title: string, sub: string, y: number, w: number, h: number,
                    on: boolean, act: () => void) {
        const n = new Node('row');
        n.layer = parent.layer;
        n.parent = parent;
        n.setPosition(0, y, 0);
        n.addComponent(UITransform).setContentSize(w, h);

        const g = n.addComponent(Graphics);
        g.fillColor = on ? new Color(234, 247, 239, 255) : new Color(255, 248, 238, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 22);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = on ? new Color(126, 199, 155, 255) : new Color(240, 224, 206, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 22);
        g.stroke();

        this.label(n, title, 0, 12, 28, new Color(122, 92, 74, 255));
        this.label(n, sub, 0, -20, 18, new Color(168, 148, 132, 255));

        if (on) {
            const t = new Node('tick');
            t.layer = n.layer;
            t.parent = n;
            t.setPosition(w / 2 - 34, 0, 0);
            const tg = t.addComponent(Graphics);
            tg.lineWidth = 6;
            tg.strokeColor = new Color(126, 199, 155, 255);
            tg.moveTo(-9, 2);
            tg.lineTo(-2, -7);
            tg.lineTo(11, 10);
            tg.stroke();
        }

        n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            if (e) e.propagationStopped = true;
            this.closeModePanel();
            Sfx.play('click');
            act();
        }, this);
    }

    private closeModePanel() {
        if (!this._modePanel) return;
        this._modePanel.destroy();
        this._modePanel = null;
    }

    /** 圆角按钮：底色 + 描边 + 居中文字 + 按下回弹 */
    private pill(parent: Node, text: string, x: number, y: number, w: number, h: number,
                 fill: Color, stroke: Color, textColor: Color, onClick: () => void): Node {
        const n = new Node('btn');
        n.layer = parent.layer;
        n.parent = parent;
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h);

        const g = n.addComponent(Graphics);
        g.fillColor = fill;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = stroke;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.stroke();

        const t = new Node('t');
        t.layer = parent.layer;
        t.parent = n;
        t.addComponent(UITransform).setContentSize(w, h);
        const l = t.addComponent(Label);
        l.string = text;
        l.fontSize = 30;
        l.lineHeight = 30;
        l.color = textColor;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;

        n.on(Node.EventType.TOUCH_END, () => {
            Sfx.play('click');
            tween(n).to(0.07, { scale: new Vec3(0.94, 0.94, 1) })
                .to(0.09, { scale: new Vec3(1, 1, 1) }).start();
            onClick();
        }, this);
        return n;
    }

    private label(parent: Node, text: string, x: number, y: number, size: number, color: Color): Label {
        const n = new Node('label');
        n.layer = parent.layer;
        n.parent = parent;
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(460, size + 20);

        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        // lineHeight 必须等于 fontSize：多出来的行距会按字体 ascent/descent 分配，
        // 中文看起来就会比节点中心偏下几个像素
        l.lineHeight = size;
        l.color = color;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;
        return l;
    }
}
