import { _decorator, Component, Node, EventTouch, UITransform, Vec2, Vec3, Sprite, Graphics, UIRenderer, Color, tween, UIOpacity, Label } from 'cc';
import { ArtType, FurnitureArt } from './FurnitureArt';
import { RoomGrid } from './RoomGrid';
import { Sfx } from './Sfx';
const { ccclass, property } = _decorator;

const GRAY = new Color(190, 190, 190, 255);

/**
 * 《小小布置家》—— 单个可拖拽物品
 *
 * 挂在物品节点上（床、柜子、台灯…），物品必须是 Room 节点的子节点，
 * Room 上要有 RoomGrid 组件。尺寸请用 36 的整数倍。
 */
@ccclass('DragItem')
export class DragItem extends Component {
    @property({ type: Node, tooltip: '房间节点（父节点），锚点 0.5/0.5，不要缩放' })
    room: Node = null!;

    @property({ type: RoomGrid, tooltip: '房间上的 RoomGrid 组件，留空会自动从父节点取' })
    board: RoomGrid = null!;

    @property({ tooltip: '按下后移动超过多少像素才算拖拽，防止手抖误触' })
    pickThreshold = 8;

    @property({ tooltip: '拿起来时向上偏移，避免手指挡住物品（约 0.1 秒缓动到位）' })
    fingerLift = 26;

    @property({ tooltip: '放不下时先在附近找空位（对小孩宽容）；关掉则直接弹回原位' })
    forgiving = false;

    private _dragging = false;
    private _picked = false;        // 是否已越过拾取阈值（真正"拿起来"）
    private _placed = true;         // 是否已经在房间里摆好过（从抽屉新拿出来的为 false）
    private _e = 0;                 // 抬起进度 0→1，用来驱动上移和放大的缓动
    private _offset = new Vec3();
    private _startUI = new Vec2();
    private _target = new Vec3();   // 手指换算出的目标位置（不含上移量）
    private _origin = new Vec3();   // 拿起来之前的位置，放不下时退回这里

    private _renderer: UIRenderer | null = null;
    private _origColor: Color | null = null;
    private _grayed = false;

    onLoad() {
        if (!this.room) this.room = this.node.parent!;

        // 预制体里存不了"房间"这种外部引用，所以这里一定要能自己找回来
        if (!this.board) this.board = this.node.parent!.getComponent(RoomGrid)!;
        if (this.board) this.board.register(this.node);
        else console.warn('[DragItem] 父节点上没有 RoomGrid，这个物品不会吸附、也不判占位');

        this.alignToGrid();
    }

    onDestroy() {
        this.closeMenu();
        if (this.board) this.board.unregister(this.node);
    }

    onEnable() {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    onDisable() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    // ---------- 对外：抽屉那边会调这三个 ----------

    /** 从抽屉里抓出来：直接出现在手指下，跳过拾取阈值 */
    grabFromDrawer(ui: Vec2) {
        const p = this.toRoom(ui);
        this.node.setPosition(p.x, p.y, 0);
        this._offset.set(0, 0, 0);
        this._target.set(p.x, p.y, 0);
        this._origin.set(p.x, p.y, 0);
        this._startUI.set(ui.x, ui.y);

        this._dragging = true;
        this._picked = true;    // 抽屉里拿出来的立刻算"拿起来"
        this._placed = false;
        // 手上拿着的还不算"摆进房间"：不注册就不会被目标条数进去，
        // 否则一按下物品、目标就跳数，最后一格会当场弹通关
        if (this.board) this.board.unregister(this.node);
        this._e = 0;
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        Sfx.play('pop', 0.9);
    }

    moveDrag(ui: Vec2) {
        if (!this._dragging) return;
        const p = this.toRoom(ui);
        this._target.set(p.x + this._offset.x, p.y + this._offset.y, 0);
    }

    endDrag() {
        if (!this._dragging) return;

        const moved = this._picked;
        this._dragging = false;
        this._picked = false;
        this.node.setScale(1, 1, 1);
        this.setTint(false);
        this._e = 0;

        if (!moved) return;
        if (!this.board) { this.clampInside(); return; }

        // 用当前视觉位置算格子：玩家看到它停在哪，就在哪判定
        const r = this.board.cellRect(this.node);

        if (this.board.canPlace(r.gx, r.gy, r.w, r.h, this.node, this.artType())) {
            this.commit(r.gx, r.gy, r.w, r.h);
            return;
        }

        if (this.forgiving) {
            const near = this.board.findNearest(r.gx, r.gy, r.w, r.h, this.node, 4);
            if (near) { this.commit(near.gx, near.gy, near.w, near.h); return; }
        }

        // 从抽屉里拿出来又没放下 → 收回抽屉（缩小淡出，和轻点的手感一致）
        if (!this._placed) { this.cancelDrag(); return; }

        this.bounceBack();
    }

    /**
     * 轻点抽屉格子：不摆放，缩小淡出后收回抽屉。
     * 必须真正拖进房间、松手落到格点上才算数。
     */
    cancelDrag() {
        this._dragging = false;
        this._picked = false;
        this._e = 0;
        if (this.board) this.board.unregister(this.node);
        Sfx.play('del', 0.7);

        const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity)!;
        tween(this.node).to(0.14, { scale: new Vec3(0.7, 0.7, 1) }).start();
        tween(op)
            .to(0.14, { opacity: 0 })
            .call(() => { if (this.node && this.node.isValid) this.node.destroy(); })
            .start();
    }

    // ---------- 内部 ----------

    private toRoom(ui: Vec2): Vec3 {
        const rt = this.room.getComponent(UITransform)!;
        return rt.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    }

    private onTouchStart(e: EventTouch) {
        this.beginDrag(e.getUILocation());
    }

    private beginDrag(ui: Vec2) {
        const p = this.toRoom(ui);

        // 记住"手指按在物品内部哪个点"，拖动时保持这个相对位置，物品才不会瞬移到手指中心
        this._offset.set(this.node.position.x - p.x, this.node.position.y - p.y, 0);
        this._startUI.set(ui.x, ui.y);
        this._target.set(this.node.position.x, this.node.position.y, 0);
        this._origin.set(this.node.position.x, this.node.position.y, 0);

        this._dragging = true;
        this._picked = false;   // 还没越过阈值，此时不许改动位置、缩放和颜色
        this._e = 0;
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        Sfx.play('pop', 0.7);
    }

    private onTouchMove(e: EventTouch) {
        if (!this._dragging) return;

        const ui = e.getUILocation();
        const dx = ui.x - this._startUI.x;
        const dy = ui.y - this._startUI.y;
        if (!this._picked && dx * dx + dy * dy < this.pickThreshold * this.pickThreshold) return; // 阈值内，不算拖

        this._picked = true;
        this.moveDrag(ui);
    }

    private onTouchEnd(e: EventTouch) {
        // 没拖动、而且本来就是摆好的 → 当成"点了一下"，弹出收起来的入口
        if (this._dragging && !this._picked && this._placed) {
            this._dragging = false;
            this.node.setScale(1, 1, 1);
            this.toggleMenu();
            return;
        }
        this.endDrag();
    }

    private onTouchCancel() {
        if (this._picked) { this.endDrag(); return; }
        this._dragging = false;
        this._picked = false;
        this._e = 0;
        this.node.setScale(1, 1, 1);
        this.setTint(false);
    }

    // ---------------- 轻点已摆好的物品：弹一个「收起来」 ----------------

    private static _openMenu: DragItem | null = null;
    private _menu: Node | null = null;

    private toggleMenu() {
        if (DragItem._openMenu === this && this._menu) { this.closeMenu(); return; }
        if (DragItem._openMenu) DragItem._openMenu.closeMenu();

        const room = this.node.parent!;
        const it = this.node.getComponent(UITransform)!;
        const rut = room.getComponent(UITransform)!;
        const W = 168, H = 78;

        const n = new Node('menu');
        n.layer = room.layer;
        room.addChild(n);
        // 贴在物品正上方；顶到房间边缘就往里让
        let y = this.node.position.y + it.height / 2 + H / 2 + 10;
        y = Math.min(y, rut.height / 2 - H / 2 - 6);
        let x = this.node.position.x;
        x = Math.min(rut.width / 2 - W / 2 - 4, Math.max(-rut.width / 2 + W / 2 + 4, x));
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(W, H);

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 255, 252);
        g.roundRect(-W / 2, -H / 2, W, H, H / 2);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(240, 214, 205, 255);
        g.roundRect(-W / 2, -H / 2, W, H, H / 2);
        g.stroke();

        // 小垃圾桶图标
        const bx = -W / 2 + 26;
        g.fillColor = new Color(196, 154, 140, 255);
        g.roundRect(bx, -10, 22, 19, 4);
        g.fill();
        g.fillColor = new Color(255, 255, 255, 255);
        g.rect(bx + 3, 4, 16, 3.5);
        g.fill();

        const t = new Node('t');
        t.layer = room.layer;
        t.parent = n;
        t.setPosition(16, 0, 0);
        t.addComponent(UITransform).setContentSize(110, H);
        const l = t.addComponent(Label);
        l.string = '收起来';
        l.fontSize = 26;
        l.lineHeight = 26;
        l.color = new Color(122, 92, 74, 255);
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;

        n.on(Node.EventType.TOUCH_END, () => this.removeSelf(), this);
        n.setSiblingIndex(room.children.length - 1);

        this._menu = n;
        DragItem._openMenu = this;
        this.scheduleOnce(this.closeMenu, 4);
    }

    private closeMenu() {
        this.unschedule(this.closeMenu);
        if (this._menu && this._menu.isValid) this._menu.destroy();
        this._menu = null;
        if (DragItem._openMenu === this) DragItem._openMenu = null;
    }

    /** 收起来：弹出一下再缩小淡出，同时取消占位 */
    private removeSelf() {
        this.closeMenu();
        if (this.board) this.board.unregister(this.node);
        Sfx.play('del');

        const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity)!;
        tween(this.node)
            .to(0.1, { scale: new Vec3(1.12, 1.12, 1) })
            .to(0.14, { scale: new Vec3(0.55, 0.55, 1) })
            .start();
        tween(op)
            .delay(0.1)
            .to(0.14, { opacity: 0 })
            .call(() => { if (this.node.isValid) this.node.destroy(); })
            .start();
    }

    update(dt: number) {
        if (!this._dragging || !this._picked) return;

        // 上移和放大都走缓动，约 0.1 秒到位——取代"松手瞬间跳 26px"
        this._e += (1 - this._e) * Math.min(1, dt * 20);
        const s = 1 + 0.06 * this._e;
        this.node.setScale(s, s, 1);
        this.node.setPosition(this._target.x, this._target.y + this.fingerLift * this._e, 0);

        this.refreshTint();
    }

    /** 拖动中实时判断能不能放下，放不下就变灰 */
    private refreshTint() {
        if (!this.board) return;

        const r = this.board.cellRect(this.node);
        const ok = this.board.canPlace(r.gx, r.gy, r.w, r.h, this.node, this.artType());
        this.setTint(!ok);
    }

    private setTint(bad: boolean) {
        if (bad === this._grayed) return;

        // 第一次真正要用的时候再找渲染组件：FurnitureArt 是后挂的，onLoad 里它还不在
        if (!this._renderer) {
            this._renderer = this.getComponent(Graphics) || this.getComponent(Sprite) || null;
            if (this._renderer) this._origColor = this._renderer.color.clone();
        }
        if (!this._renderer || !this._origColor) return;

        this._grayed = bad;
        this._renderer.color = bad ? GRAY : this._origColor;
    }

    /** 真正落定：贴到格点上，并在这时候才算"进了房间" */
    /** 自己是什么家具（叠放判定、层级都用它） */
    private artType(): ArtType | null {
        const a = this.getComponent(FurnitureArt);
        return a ? a.artType : null;
    }

    private commit(gx: number, gy: number, w: number, h: number) {
        this.applyCell(gx, gy, w, h);
        this._placed = true;
        if (this.board) this.board.register(this.node);
        // 地毯是地面层：后放的地毯要沉到所有东西下面，不然会盖住床和柜子
        const t = this.artType();
        if (t === ArtType.Rug) this.node.setSiblingIndex(0);
        else if (this.node.parent) this.node.setSiblingIndex(this.node.parent.children.length - 1);
        Sfx.play('place');
    }

    private applyCell(gx: number, gy: number, w: number, h: number) {
        const p = this.board!.positionOf(gx, gy, w, h);
        this.node.setPosition(p.x, p.y, 0);
    }

    private bounceBack() {
        Sfx.play('nope', 0.8);
        tween(this.node)
            .to(0.2, { position: this._origin.clone() }, { easing: 'backOut' })
            .start();
    }

    /**
     * 把节点归位到最近的格点。
     * 编辑器里手摆的位置几乎不会是 36 的整数倍，差十几像素的时候，
     * 判定按"最近格"算、画面按真实位置画，就会出现"看着没碰、实际压住了"。
     */
    private alignToGrid() {
        if (!this.board) return;
        const r = this.board.cellRect(this.node);
        const gx = Math.min(Math.max(0, r.gx), Math.max(0, this.board.cols - r.w));
        const gy = Math.min(Math.max(0, r.gy), Math.max(0, this.board.rows - r.h));
        const p = this.board.positionOf(gx, gy, r.w, r.h);
        this.node.setPosition(p.x, p.y, 0);
    }

    /** 没有 RoomGrid 时的兜底：至少别让它跑出房间 */
    private clampInside() {
        const rt = this.room.getComponent(UITransform)!;
        const it = this.node.getComponent(UITransform)!;
        const halfW = rt.width / 2 - it.width / 2;
        const halfH = rt.height / 2 - it.height / 2;
        const x = Math.min(halfW, Math.max(-halfW, this.node.position.x));
        const y = Math.min(halfH, Math.max(-halfH, this.node.position.y));
        this.node.setPosition(x, y, 0);
    }
}
