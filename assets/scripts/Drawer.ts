import { _decorator, Component, Node, UITransform, Graphics, Label, Color, EventTouch, Enum, Mask, Vec2, Vec3, tween, Tween } from 'cc';
import { ArtType, ITEMS, drawFurniture, FurnitureArt } from './FurnitureArt';
import { DragItem } from './DragItem';
const { ccclass, property } = _decorator;

const SLOP = 12;        // 超过这个距离才算"开始拖"，否则当手抖
const SLOT = 128;       // 格子边长（5 个 + 4 个间距 = 672 = VIEW_W，正好一行 5 个）
const GAP = 8;          // 格子横向间距
const ROW_H = 158;      // 一行的总高（格子 + 下面那行名字）
const PAD = 12;         // 抽屉上下留白
const PAD_BOTTOM = 56;  // 底部额外留白：把格子整体往上抬，别贴到手机的手势条
const VIEW_W = 672;     // 可以看到的宽度，超过就要横向滚

/**
 * 《小小布置家》—— 底部抽屉
 *
 * 挂在 Canvas 下面的一个空节点上（720 宽，高度自己按行数算），把 room 拖进去即可。
 *
 * 布局：一件东西只占一格，最多两行；一排装不下就**横向滚动**。
 * 手感：
 *   按住往上拖 → 东西跟着手指走，松手落到格子上才算摆好
 *   左右拖     → 滚动抽屉（不会误抓东西）
 *   原地点一下 → 什么都不发生（必须拖进房间才会摆放）
 */
@ccclass('Drawer')
export class Drawer extends Component {
    @property({ type: Node, tooltip: '房间节点（物品会被创建成它的子节点）' })
    room: Node = null!;

    @property({ type: [Enum(ArtType)], tooltip: '抽屉里有哪些东西，按显示顺序排' })
    itemTypes: ArtType[] = [];

    @property({ tooltip: '格子边长' })
    slotSize = SLOT;

    @property({ tooltip: '格子间距' })
    gap = GAP;

    private _view: Node = null!;
    private _content: Node = null!;
    private _scroller: Node = null!;
    private _arrowL: Node | null = null;
    private _arrowR: Node | null = null;

    private _contentW = 0;
    private _rows = 1;
    private _active: DragItem | null = null;

    // 手势状态：还没判断 / 正在横滚 / 正在拖东西
    private _mode: 'idle' | 'scroll' | 'drag' = 'idle';
    private _downType: ArtType | null = null;
    private _downX = 0;
    private _downY = 0;
    private _startX = 0;
    private _lastX = 0;
    private _vx = 0;
    // 同一个触摸事件会被格子层和垫片层各分发一次，靠对象身份去重
    private _lastEvt: EventTouch | null = null;
    private _peek: Tween<Node> | null = null;

    onLoad() {
        if (!this.room) console.warn('[Drawer] 没有指定 room，点了会没反应');

        // 滚动视口：Mask 会把超出的部分裁掉
        const view = new Node('view');
        view.layer = this.node.layer;
        view.parent = this.node;
        view.addComponent(UITransform).setContentSize(VIEW_W, 200);
        const mask = view.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        this._view = view;

        // 真正放格子的容器，滚动就是移它
        const content = new Node('content');
        content.layer = this.node.layer;
        content.parent = view;
        content.addComponent(UITransform).setContentSize(VIEW_W, 200);
        this._content = content;

        // 透明垫片：格子之间有空隙，手势只绑在格子上时，从缝里起手是滑不动的。
        // 这一层铺在格子下面（sibling 0），格子优先命中，没打到格子就落到它身上。
        const scroller = new Node('scroller');
        scroller.layer = this.node.layer;
        scroller.parent = view;
        scroller.setSiblingIndex(0);
        scroller.addComponent(UITransform).setContentSize(VIEW_W, 200);
        scroller.on(Node.EventType.TOUCH_START, this.onBgDown, this);
        scroller.on(Node.EventType.TOUCH_MOVE, this.onMove, this);
        scroller.on(Node.EventType.TOUCH_END, this.onUp, this);
        scroller.on(Node.EventType.TOUCH_CANCEL, this.onUp, this);
        this._scroller = scroller;

        this.makeArrows();
        this.drawPanel();
        this.buildSlots();
    }

    // ---------- 底板与箭头 ----------

    /** 抽屉底板：运行时画，省得再做一张图 */
    private drawPanel() {
        const ut = this.getComponent(UITransform);
        if (!ut) { console.warn('[Drawer] 这个节点没有 UITransform，画不出底板'); return; }

        const g = this.getComponent(Graphics) || this.addComponent(Graphics)!;
        g.clear();
        g.fillColor = new Color(255, 249, 240, 255);
        g.roundRect(-ut.width / 2, -ut.height / 2, ut.width, ut.height, 26);
        g.fill();
    }

    /** 能滚的时候，左右边缘各露一个小三角，告诉孩子"这边还有东西" */
    private makeArrows() {
        const mk = (dir: number) => {
            const n = new Node(dir < 0 ? 'arrowL' : 'arrowR');
            n.layer = this.node.layer;
            n.parent = this.node;
            n.setPosition(dir * (VIEW_W / 2 - 10), 0, 0);
            const g = n.addComponent(Graphics);
            g.fillColor = new Color(206, 186, 168, 235);
            g.moveTo(dir * 8, 12);
            g.lineTo(dir * 8, -12);
            g.lineTo(dir * -6, 0);
            g.close();
            g.fill();
            n.active = false;
            return n;
        };
        this._arrowL = mk(-1);
        this._arrowR = mk(1);

        // 小三角一直轻轻地一鼓一缩，余光里能注意到
        const pulse = (n: Node, delay: number) => {
            n.setScale(1, 1, 1);
            tween(n)
                .delay(delay)
                .repeatForever(
                    tween(n)
                        .to(0.5, { scale: new Vec3(1.14, 1.14, 1) }, { easing: 'sineInOut' })
                        .to(0.5, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
                )
                .start();
        };
        pulse(this._arrowL, 0);
        pulse(this._arrowR, 0.5);
    }

    private updateArrows() {
        if (!this._arrowL || !this._arrowR) return;
        const range = Math.max(0, this._contentW - VIEW_W);
        if (range < 4) {
            this._arrowL.active = false;
            this._arrowR.active = false;
            return;
        }
        const x = this._content.position.x;
        this._arrowL.active = x < range / 2 - 4;    // 左边还有
        this._arrowR.active = x > -range / 2 + 4;   // 右边还有
    }

    // ---------- 布局 ----------

    /** 进场时朝右边"探头"两下：告诉孩子这里还能滑 */
    private playPeek() {
        this._peek?.stop();
        this._peek = null;
        const range = Math.max(0, this._contentW - VIEW_W);
        if (range < 48) return;            // 一屏放得下就别晃了

        const x0 = this._content.position.x;
        const d1 = Math.min(52, range * 0.6);
        const d2 = Math.min(26, range * 0.35);

        // 只晃三轮（约 4 秒）就停：一直晃会像卡住了，而且会一直抢注意力。
        // 停下之后还有左右两个小三角在呼吸，提示不会丢。
        const round = tween()
            .to(0.26, { position: new Vec3(x0 - d1, 0, 0) }, { easing: 'sineInOut' })
            .to(0.32, { position: new Vec3(x0, 0, 0) }, { easing: 'sineInOut' })
            .delay(0.14)
            .to(0.22, { position: new Vec3(x0 - d2, 0, 0) }, { easing: 'sineInOut' })
            .to(0.26, { position: new Vec3(x0, 0, 0) }, { easing: 'sineInOut' })
            .delay(0.4);

        this._peek = tween(this._content)
            .delay(0.45)
            .repeat(3, round)
            .call(() => { this._peek = null; })
            .start();
    }

    private buildSlots() {
        const n = this.itemTypes.length;
        if (!n) return;   // 关卡还没把物品填进来（LevelFlow 会在 start 之后调 setItems）

        // 5 件以内一行放得下；再多就排两行，两行还装不下就横向滚
        const rows = n <= 5 ? 1 : 2;
        this.applyRows(rows);

        const cols = Math.ceil(n / rows);
        const contentW = cols * SLOT + (cols - 1) * GAP;
        this._contentW = contentW;
        this._content.getComponent(UITransform)!.setContentSize(contentW, rows * ROW_H);
        // 装不下时默认停在最左边（而不是居中），否则一进来就是中间那几件
        const initRange = Math.max(0, contentW - VIEW_W);
        this._content.setPosition(initRange / 2, 0, 0);

        for (let i = 0; i < n; i++) {
            const col = Math.floor(i / rows);
            const row = i % rows;
            const x = -contentW / 2 + SLOT / 2 + col * (SLOT + GAP);
            // 名字挂在格子下面，所以两行不能对称放：上排要再往上抬 8px 让位
            // 两排相隔一个 ROW_H；整体上抬 11px，因为名字挂在格子下面、视觉重心偏下
            const y = rows === 2 ? (row === 0 ? ROW_H / 2 + 11 : -ROW_H / 2 + 11) : 0;
            this.makeSlot(this.itemTypes[i], x, y);
        }
        this.updateArrows();
        this.playPeek();
    }

    /**
     * 行数变了要改高度。**底边钉在屏幕上不动**，只往上长，
     * 不然抽屉会缩到屏幕外面去。
     */
    private applyRows(rows: number) {
        this._rows = rows;
        const ut = this.getComponent(UITransform)!;
        const oldH = ut.height;
        const newH = rows * ROW_H + PAD * 2 + PAD_BOTTOM;
        if (Math.abs(newH - oldH) < 0.5) {
            this._view.getComponent(UITransform)!.setContentSize(VIEW_W, newH);
            if (this._scroller) this._scroller.getComponent(UITransform)!.setContentSize(VIEW_W, newH);
            return;
        }

        const bottom = this.node.position.y - oldH / 2;
        ut.setContentSize(ut.width, newH);
        this.node.setPosition(this.node.position.x, bottom + newH / 2, 0);
        this._view.getComponent(UITransform)!.setContentSize(VIEW_W, newH);
        if (this._scroller) this._scroller.getComponent(UITransform)!.setContentSize(VIEW_W, newH);
        this.drawPanel();

        // 箭头要跟着重摆位置
        if (this._arrowL) this._arrowL.setPosition(-(VIEW_W / 2 - 10), 0, 0);
        if (this._arrowR) this._arrowR.setPosition(VIEW_W / 2 - 10, 0, 0);
    }

    /** 换关时重建抽屉：清掉旧格子，按新的一批物品重排 */
    public setItems(types: ArtType[]) {
        this.itemTypes = types;
        this._active = null;
        this._contentW = 0;
        this._content.setPosition(0, 0, 0);
        for (const c of this._content.children.slice()) c.destroy();
        this.buildSlots();
    }

    private makeSlot(type: ArtType, x: number, y: number): Node {
        const spec = ITEMS[type];
        const s = SLOT;

        const n = new Node(spec.name);
        n.layer = this.node.layer;          // 不改层的话 UI 相机看不见它
        n.parent = this._content;
        n.setPosition(x, y, 0);

        const ut = n.getComponent(UITransform) || n.addComponent(UITransform)!;
        ut.setContentSize(s, s);

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(255, 252, 246, 255);
        g.roundRect(-s / 2, -s / 2, s, s, s * 0.22);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(240, 226, 210, 255);
        g.roundRect(-s / 2, -s / 2, s, s, s * 0.22);
        g.stroke();

        this.addPreview(n, type);
        this.addName(n, spec.name);

        n.on(Node.EventType.TOUCH_START, (e: EventTouch) => this.onDown(e, type), this);
        n.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this.onMove(e), this);
        n.on(Node.EventType.TOUCH_END, (e: EventTouch) => this.onUp(e), this);
        n.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => this.onUp(e), this);
        return n;
    }

    /** 格子里的小图：就是把家具按比例缩小重画一遍，所以和拖出来的一定长得一样 */
    private addPreview(slot: Node, type: ArtType) {
        const spec = ITEMS[type];
        const box = SLOT - SLOT * 0.3;
        const k = Math.min(box / spec.w, box / spec.h);

        const art = new Node('preview');
        art.layer = slot.layer;
        art.parent = slot;
        art.setPosition(0, 0, 0);

        const g = art.addComponent(Graphics);
        drawFurniture(g, type, spec.w * k, spec.h * k);
    }

    private addName(slot: Node, name: string) {
        const lb = new Node('name');
        lb.layer = slot.layer;
        lb.parent = slot;
        lb.setPosition(0, -SLOT / 2 - 10, 0);

        const ut = lb.getComponent(UITransform) || lb.addComponent(UITransform)!;
        ut.setContentSize(SLOT + 24, 24);

        const label = lb.addComponent(Label);
        label.string = name;
        label.fontSize = 18;
        label.lineHeight = 20;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.NONE;
        label.color = new Color(122, 102, 92, 255);
    }

    /** 现场造一件家具：尺寸 + 外观 + 拖拽，全在代码里，不用预制体 */
    private createItem(type: ArtType): Node {
        const spec = ITEMS[type];
        const n = new Node(spec.name);
        n.layer = this.room.layer;

        const ut = n.getComponent(UITransform) || n.addComponent(UITransform)!;
        ut.setContentSize(spec.w, spec.h);

        const art = n.addComponent(FurnitureArt);
        art.artType = type;
        n.addComponent(DragItem);
        return n;
    }

    // ---------- 滚动 ----------

    private setScroll(x: number) {
        const range = Math.max(0, this._contentW - VIEW_W);
        const cx = Math.max(-range / 2, Math.min(range / 2, x));
        this._content.setPosition(cx, 0, 0);
        this.updateArrows();
    }

    /** 松手后的惯性：速度衰减到很小就停 */
    private startGlide() {
        if (Math.abs(this._vx) < 2) return;
        this.schedule(this.glideStep, 1 / 60);
    }

    private glideStep(dt: number) {
        this._vx *= Math.pow(0.002, dt);        // 约每 0.1 秒掉到 40%
        if (Math.abs(this._vx) < 12) {
            this.unschedule(this.glideStep);
            return;
        }
        this.setScroll(this._content.position.x + this._vx * dt);
    }

    // ---------- 触摸 ----------

    /** 从格子缝里、或者上下留白处按下去：只滚动，不生成物品 */
    private onBgDown(e: EventTouch) {
        // Cocos 的触摸会派发给所有命中的节点，按在格子上时这一层也会收到。
        // 先看手指是不是压在某个格子上，是就让给格子自己处理（否则会把 _downType 清掉，拖不动东西）。
        if (this.overSlot(e.getUILocation())) return;
        this.onDown(e, null);
    }

    /** 手指是否落在某个格子（或它的名字）上 */
    private overSlot(ui: Vec2): boolean {
        const ct = this._content.getComponent(UITransform);
        if (!ct) return false;
        const p = ct.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        for (const n of this._content.children) {
            const ut = n.getComponent(UITransform);
            if (!ut) continue;
            if (Math.abs(p.x - n.position.x) <= ut.width / 2 &&
                Math.abs(p.y - n.position.y) <= ut.height / 2) return true;
        }
        return false;
    }

    private onDown(e: EventTouch, type: ArtType | null) {
        this._peek?.stop();          // 手一碰就交还控制权，别和手指抢
        this._peek = null;

        const ui = e.getUILocation();
        this._downX = ui.x;
        this._downY = ui.y;
        this._lastX = ui.x;
        this._vx = 0;
        this._downType = type;
        this._startX = this._content.position.x;
        this._mode = 'idle';
        this.unschedule(this.glideStep);
    }

    private onMove(e: EventTouch) {
        if (this._lastEvt === e) return;
        this._lastEvt = e;

        const ui = e.getUILocation();
        const dx = ui.x - this._downX;
        const dy = ui.y - this._downY;

        if (this._mode === 'idle') {
            // 横向为主 → 认为是滚抽屉；竖向为主 → 认为是把东西拖出去
            if (Math.abs(dx) > SLOP && Math.abs(dx) >= Math.abs(dy)) {
                this._mode = 'scroll';
            } else if (Math.abs(dy) > SLOP) {
                this.beginDrag(ui);
            }
        }

        if (this._mode === 'scroll') {
            this._vx = (ui.x - this._lastX) * 60;    // 换算成"每秒多少像素"
            this._lastX = ui.x;
            this.setScroll(this._startX + dx);
        } else if (this._mode === 'drag' && this._active) {
            this._active.moveDrag(ui);
        }
    }

    private beginDrag(ui: Vec2) {
        if (!this.room || this._downType === null) return;

        const node = this.createItem(this._downType);
        this.room.addChild(node);          // 先进场景，组件的 onLoad 才会跑

        const item = node.getComponent(DragItem);
        if (!item) { node.destroy(); return; }

        this._active = item;
        this._mode = 'drag';
        item.grabFromDrawer(ui);
    }

    private onUp(e: EventTouch) {
        if (this._lastEvt === e) return;
        this._lastEvt = e;

        if (this._mode === 'drag') {
            const it = this._active;
            this._active = null;
            if (it && it.isValid) it.endDrag();
        } else if (this._mode === 'scroll') {
            this.startGlide();
        }
        // idle（原地点一下）：什么都不做——必须拖进房间才算摆放

        this._mode = 'idle';
        this._downType = null;
    }
}
