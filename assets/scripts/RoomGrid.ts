import { _decorator, Component, EventTarget, Node, UITransform, Vec2 } from 'cc';
import { ArtType, canStack, FurnitureArt } from './FurnitureArt';
const { ccclass, property } = _decorator;

export interface CellRect { gx: number; gy: number; w: number; h: number; }

/**
 * 《小小布置家》—— 房间网格 / 占位判定
 *
 * 挂在 Room 节点上。物品节点自己在 onLoad 时注册进来，所以这里不需要主动扫描子节点。
 * 坐标系：房间锚点 0.5/0.5，格子上左为原点 (0,0)，横 x 纵 y。
 */
@ccclass('RoomGrid')
export class RoomGrid extends Component {
    @property({ tooltip: '网格边长（设计像素）' })
    grid = 40;

    @property({ tooltip: '列数' })
    cols = 16;

    @property({ tooltip: '行数' })
    rows = 18;

    private _items = new Set<Node>();

    /** 有东西进/出房间时发 'changed'，顶部目标条靠它刷新 */
    readonly changed = new EventTarget();

    get items(): Node[] { return Array.from(this._items); }

    private rt(): UITransform {
        return this.getComponent(UITransform)!;
    }

    register(node: Node) { this._items.add(node); this.changed.emit('changed'); }
    unregister(node: Node) { this._items.delete(node); this.changed.emit('changed'); }

    /** 节点当前落在哪几个格子上 */
    cellRect(node: Node): CellRect {
        const rt = this.rt();
        const it = node.getComponent(UITransform)!;
        const p = node.position;
        return {
            gx: Math.round((p.x - it.width / 2 + rt.width / 2) / this.grid),
            gy: Math.round((rt.height / 2 - (p.y + it.height / 2)) / this.grid),
            w: Math.max(1, Math.round(it.width / this.grid)),
            h: Math.max(1, Math.round(it.height / this.grid)),
        };
    }

    /** 格子坐标 → 节点应该放的位置（物品锚点 0.5/0.5） */
    positionOf(gx: number, gy: number, w: number, h: number): Vec2 {
        const rt = this.rt();
        return new Vec2(
            -rt.width / 2 + gx * this.grid + (w * this.grid) / 2,
            rt.height / 2 - gy * this.grid - (h * this.grid) / 2
        );
    }

    inBounds(gx: number, gy: number, w: number, h: number): boolean {
        return gx >= 0 && gy >= 0 && gx + w <= this.cols && gy + h <= this.rows;
    }

    /** 能不能放下：不出房间 + 不和别的物品重叠（抱枕压床、台灯压柜这类叠放除外） */
    canPlace(gx: number, gy: number, w: number, h: number, ignore?: Node, top?: ArtType): boolean {
        if (!this.inBounds(gx, gy, w, h)) return false;

        for (const other of this._items) {
            if (other === ignore || !other.isValid || !other.activeInHierarchy) continue;
            const r = this.cellRect(other);
            // 两个矩形相交 = 重叠
            if (!(gx < r.gx + r.w && r.gx < gx + w && gy < r.gy + r.h && r.gy < gy + h)) continue;
            // 重叠了，但如果是"本来就该叠着"的组合（抱枕/玩偶/台灯/地毯），放行
            if (canStack(top, other.getComponent(FurnitureArt)?.artType)) continue;
            return false;
        }
        return true;
    }

    /** 从最底下一排往上、从左往右找第一个能放下的位置（轻点抽屉直接落位用） */
    firstFree(w: number, h: number, ignore?: Node): CellRect | null {
        for (let gy = this.rows - h; gy >= 0; gy--) {
            for (let gx = 0; gx + w <= this.cols; gx++) {
                if (this.canPlace(gx, gy, w, h, ignore)) return { gx, gy, w, h };
            }
        }
        return null;
    }

    /** 在半径 radius 格内找最近的空位，找不到返回 null（给"宽容模式"用） */
    findNearest(gx: number, gy: number, w: number, h: number, ignore?: Node, radius = 4): CellRect | null {
        for (let r = 1; r <= radius; r++) {
            let best: CellRect | null = null;
            let bestD = Infinity;
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 只看这一圈
                    if (!this.canPlace(gx + dx, gy + dy, w, h, ignore)) continue;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) { bestD = d; best = { gx: gx + dx, gy: gy + dy, w, h }; }
                }
            }
            if (best) return best;
        }
        return null;
    }
}
