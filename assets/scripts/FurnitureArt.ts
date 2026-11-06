import { _decorator, Component, Graphics, UITransform, Sprite, Color, Enum } from 'cc';
const { ccclass, property } = _decorator;

/** 家具种类。序号不能随手改，编辑器里已经存了这些值 */
export enum ArtType {
    Bed = 0,
    Cabinet = 1,
    Lamp = 2,
    Rug = 3,
    Plant = 4,
    Stool = 5,
    Poster = 6,
    Bear = 7,
    Sofa = 8,
    Shelf = 9,
    ToyBox = 10,
    Cat = 11,
    TV = 12,
    FloorLamp = 13,
    Pillow = 14,
    Clock = 15,
    Curtain = 16,
    FishTank = 17,
}

export interface ItemSpec { name: string; w: number; h: number; }

/** 每件家具的尺寸，全部是 36 的整数倍，直接对应格子 */
export const ITEMS: Record<number, ItemSpec> = {
    [ArtType.Bed]:     { name: '小床', w: 160, h: 120 },
    [ArtType.Cabinet]: { name: '矮柜', w: 120, h: 80 },
    [ArtType.Lamp]:    { name: '台灯', w: 40,  h: 80 },
    [ArtType.Rug]:     { name: '地毯', w: 160, h: 120 },
    [ArtType.Plant]:   { name: '绿植', w: 80,  h: 80 },
    [ArtType.Stool]:   { name: '小凳', w: 80,  h: 80 },
    [ArtType.Poster]:  { name: '挂画', w: 80,  h: 40 },
    [ArtType.Bear]:    { name: '小熊', w: 80,  h: 80 },
    [ArtType.Sofa]:    { name: '沙发', w: 160, h: 80 },
    [ArtType.Shelf]:   { name: '书架', w: 80,  h: 120 },
    [ArtType.ToyBox]:  { name: '玩具箱', w: 80, h: 80 },
    [ArtType.Cat]:     { name: '小猫', w: 80,  h: 80 },
    [ArtType.TV]:      { name: '电视', w: 120, h: 80 },
    [ArtType.FloorLamp]:{ name: '落地灯', w: 40, h: 120 },
    [ArtType.Pillow]:  { name: '抱枕', w: 80,  h: 40 },
    [ArtType.Clock]:   { name: '时钟', w: 80,  h: 80 },
    [ArtType.Curtain]: { name: '窗帘', w: 120, h: 120 },
    [ArtType.FishTank]:{ name: '鱼缸', w: 80,  h: 120 },
};

/**
 * 谁能压在谁身上。
 *
 * 只有"本来就该叠着放"的东西才允许重叠，其余一律照旧禁止——
 * 不然孩子会把整间屋子摞成一堆，看着像穿模而不是布置。
 */
export const STACK_ON: Partial<Record<ArtType, ArtType[]>> = {
    [ArtType.Pillow]: [ArtType.Bed, ArtType.Sofa, ArtType.Stool, ArtType.Cabinet, ArtType.Shelf],
    [ArtType.Bear]: [ArtType.Bed, ArtType.Sofa, ArtType.Shelf, ArtType.Cabinet],
    [ArtType.Cat]: [ArtType.Bed, ArtType.Sofa],
    [ArtType.Lamp]: [ArtType.Cabinet, ArtType.Shelf, ArtType.ToyBox],
    [ArtType.Poster]: [ArtType.Curtain],
};

/** top 能不能压在 under 上面。地毯是地面层：谁都能铺上去，它也能塞到任何东西下面。 */
export function canStack(top: ArtType | null | undefined, under: ArtType | null | undefined): boolean {
    if (under === null || under === undefined) return false;
    if (under === ArtType.Rug) return true;
    if (top === null || top === undefined) return false;
    if (top === ArtType.Rug) return true;
    const list = STACK_ON[top];
    return !!list && list.indexOf(under) >= 0;
}


function col(hex: string): Color {
    const n = parseInt(hex.slice(1), 16);
    return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
}

/**
 * 画图用的小工具。
 * 坐标一律用「左上角为原点、向下为正」的比例值（0~1），
 * 跟 Canvas 那套习惯一致，写起来不用老想着 y 轴是反的。
 */
class Pen {
    constructor(private g: Graphics, private W: number, private H: number, private dx: number, private dy: number) { }

    private X(fx: number) { return this.dx - this.W / 2 + fx * this.W; }
    private Y(fy: number, fh: number) { return this.dy + this.H / 2 - (fy + fh) * this.H; }
    private Wd(f: number) { return f * this.W; }
    private Hd(f: number) { return f * this.H; }

    /** 圆角矩形。fx/fy 是左上角，fw/fh 是宽高，全部按比例给 */
    rect(fx: number, fy: number, fw: number, fh: number, r: number, hex: string) {
        const g = this.g;
        g.fillColor = col(hex);
        const x = this.X(fx), y = this.Y(fy, fh), w = this.Wd(fw), h = this.Hd(fh);
        if (r > 0) g.roundRect(x, y, w, h, r);
        else g.rect(x, y, w, h);
        g.fill();
    }

    ellipse(fcx: number, fcy: number, frx: number, fry: number, hex: string) {
        const g = this.g;
        g.fillColor = col(hex);
        g.ellipse(this.X(fcx), this.Y(fcy, 0), this.Wd(frx), this.Hd(fry));
        g.fill();
    }

    /** 正圆：半径按短边算，不然扁的家具上会画成椭圆 */
    circle(fcx: number, fcy: number, fr: number, hex: string) {
        const g = this.g;
        g.fillColor = col(hex);
        g.circle(this.X(fcx), this.Y(fcy, 0), fr * Math.min(this.W, this.H));
        g.fill();
    }

    poly(pts: number[][], hex: string) {
        const g = this.g;
        g.fillColor = col(hex);
        g.moveTo(this.X(pts[0][0]), this.Y(pts[0][1], 0));
        for (let i = 1; i < pts.length; i++) g.lineTo(this.X(pts[i][0]), this.Y(pts[i][1], 0));
        g.close();
        g.fill();
    }
}

/**
 * 把一件家具画到 Graphics 上。
 * w/h 是绘制区域尺寸（默认等于节点尺寸），dx/dy 用来在抽屉格子里做缩放预览。
 */
export function drawFurniture(g: Graphics, type: ArtType, w: number, h: number, dx = 0, dy = 0) {
    g.clear();
    const p = new Pen(g, w, h, dx, dy);

    switch (type) {
        case ArtType.Bed: {
            // 床头板（靠墙，在最上面）
            p.rect(0.035, 0.00, 0.93, 0.34, 9, '#ef9db4');
            p.rect(0.100, 0.055, 0.80, 0.20, 7, '#f7b8c9');
            // 床垫
            p.rect(0.000, 0.30, 1.00, 0.57, 9, '#ffe3ee');
            // 枕头
            p.rect(0.075, 0.315, 0.34, 0.16, 8, '#ffffff');
            // 被子 + 翻边
            p.rect(0.000, 0.47, 1.00, 0.40, 9, '#f78fb3');
            p.rect(0.000, 0.47, 1.00, 0.11, 7, '#ffbcd2');
            // 两只床脚，落到最下沿，看起来才是踩在地上
            p.rect(0.075, 0.855, 0.10, 0.145, 4, '#d9738f');
            p.rect(0.825, 0.855, 0.10, 0.145, 4, '#d9738f');
            break;
        }
        case ArtType.Cabinet: {
            p.rect(0.02, 0.10, 0.96, 0.86, 9, '#e0a86a');
            p.rect(0.08, 0.18, 0.84, 0.70, 7, '#f2c489');
            p.rect(0.485, 0.18, 0.03, 0.70, 0, '#d99a5e');
            p.circle(0.365, 0.53, 0.055, '#8a5a2b');
            p.circle(0.635, 0.53, 0.055, '#8a5a2b');
            break;
        }
        case ArtType.Lamp: {
            p.ellipse(0.50, 0.965, 0.30, 0.028, '#e0b06a');   // 底座
            p.rect(0.465, 0.30, 0.07, 0.67, 2, '#c9a06a');    // 灯杆
            p.poly([[0.14, 0.30], [0.86, 0.30], [0.70, 0.03], [0.30, 0.03]], '#ffd166');
            p.ellipse(0.50, 0.315, 0.28, 0.035, '#fff0b8');   // 灯光
            break;
        }
        case ArtType.Rug: {
            p.rect(0.00, 0.00, 1.00, 1.00, 16, '#a8e0c8');
            p.rect(0.06, 0.06, 0.88, 0.88, 12, '#8fd3b6');
            p.rect(0.11, 0.11, 0.78, 0.78, 10, '#b9ead4');
            for (let j = 0; j < 4; j++) {
                for (let i = 0; i < 5; i++) {
                    p.circle(0.20 + i * 0.15, 0.25 + j * 0.17, 0.032, '#e8faf2');
                }
            }
            break;
        }
        case ArtType.Plant: {
            p.circle(0.50, 0.40, 0.21, '#6fc48a');
            p.circle(0.33, 0.47, 0.14, '#59b377');
            p.circle(0.67, 0.47, 0.14, '#59b377');
            p.circle(0.45, 0.33, 0.08, '#8fd9a5');
            p.poly([[0.34, 0.60], [0.66, 0.60], [0.61, 1.00], [0.39, 1.00]], '#d9885f');
            p.rect(0.31, 0.565, 0.38, 0.075, 3, '#e8a07a');
            break;
        }
        case ArtType.Stool: {
            p.rect(0.14, 0.52, 0.10, 0.44, 3, '#9575cd');
            p.rect(0.76, 0.52, 0.10, 0.44, 3, '#9575cd');
            p.rect(0.08, 0.22, 0.84, 0.32, 12, '#b39ddb');
            p.rect(0.08, 0.22, 0.84, 0.10, 10, '#c7b3e8');
            break;
        }
        case ArtType.Poster: {
            p.rect(0.03, 0.05, 0.94, 0.90, 4, '#ffffff');
            p.rect(0.12, 0.16, 0.76, 0.68, 2, '#ffe3ea');
            p.circle(0.44, 0.44, 0.10, '#ff8fab');
            p.circle(0.56, 0.44, 0.10, '#ff8fab');
            p.poly([[0.355, 0.50], [0.645, 0.50], [0.50, 0.80]], '#ff8fab');
            break;
        }
        case ArtType.Bear: {
            p.circle(0.24, 0.20, 0.13, '#b98a5e');
            p.circle(0.76, 0.20, 0.13, '#b98a5e');
            p.circle(0.24, 0.20, 0.07, '#e8c4a0');
            p.circle(0.76, 0.20, 0.07, '#e8c4a0');
            p.circle(0.50, 0.55, 0.34, '#c99568');
            p.ellipse(0.50, 0.64, 0.17, 0.12, '#f0d9c0');
            p.circle(0.38, 0.48, 0.045, '#3a2a20');
            p.circle(0.62, 0.48, 0.045, '#3a2a20');
            p.ellipse(0.50, 0.60, 0.055, 0.04, '#4a3328');
            break;
        }
        case ArtType.Sofa: {
            // 长沙发：靠背在上，坐垫在中，两端扶手，最下面两只脚
            p.rect(0.035, 0.02, 0.93, 0.40, 14, '#e8935b');   // 靠背
            p.rect(0.075, 0.08, 0.85, 0.26, 10, '#f2ab74');   // 靠背亮面
            p.rect(0.000, 0.34, 1.00, 0.36, 13, '#f7bd8c');   // 坐垫
            p.rect(0.035, 0.30, 0.93, 0.10, 8, '#ffd9b5');    // 坐垫上沿
            p.rect(0.000, 0.26, 0.10, 0.50, 11, '#dd8550');   // 左扶手
            p.rect(0.900, 0.26, 0.10, 0.50, 11, '#dd8550');   // 右扶手
            p.rect(0.105, 0.66, 0.075, 0.14, 4, '#b8693a');
            p.rect(0.820, 0.66, 0.075, 0.14, 4, '#b8693a');
            break;
        }
        case ArtType.Shelf: {
            // 书架：外框 + 两层隔板 + 彩色书脊
            p.rect(0.05, 0.01, 0.90, 0.98, 6, '#d7a06a');
            p.rect(0.11, 0.06, 0.78, 0.88, 4, '#f6e0c4');
            p.rect(0.11, 0.615, 0.78, 0.028, 0, '#cf9257');   // 上隔板
            p.rect(0.11, 0.325, 0.78, 0.028, 0, '#cf9257');   // 下隔板
            // 上层三本书
            p.rect(0.155, 0.435, 0.115, 0.175, 2, '#ef8fa8');
            p.rect(0.285, 0.455, 0.100, 0.155, 2, '#7ec79b');
            p.rect(0.400, 0.425, 0.115, 0.185, 2, '#8fb8e8');
            // 下层两本书 + 一个盒子
            p.rect(0.155, 0.135, 0.110, 0.185, 2, '#f0b46a');
            p.rect(0.280, 0.155, 0.095, 0.165, 2, '#b39ddb');
            p.rect(0.430, 0.150, 0.330, 0.170, 6, '#f7b8c9');
            break;
        }
        case ArtType.ToyBox: {
            // 玩具箱：箱体 + 掀开的盖 + 露出的小球和积木
            p.circle(0.300, 0.300, 0.105, '#ffd166');          // 球
            p.rect(0.520, 0.190, 0.230, 0.230, 5, '#f78fb3');  // 积木
            p.rect(0.110, 0.470, 0.780, 0.420, 9, '#8fb8e8');  // 箱体
            p.rect(0.160, 0.560, 0.680, 0.260, 7, '#6d9ad0');  // 箱体阴影/内侧
            p.rect(0.060, 0.360, 0.880, 0.170, 8, '#a9cdf0');  // 盖沿
            p.rect(0.060, 0.330, 0.880, 0.055, 3, '#5d88bd');  // 盖底阴影
            p.rect(0.400, 0.600, 0.200, 0.070, 4, '#ffffff');  // 标签
            break;
        }
        case ArtType.Cat: {
            // 坐着的猫：尾巴在右，脑袋在上
            p.ellipse(0.760, 0.760, 0.135, 0.075, '#c9c0b8');
            p.ellipse(0.520, 0.700, 0.240, 0.250, '#d8d0c8');  // 身体
            p.circle(0.500, 0.330, 0.235, '#e0d8d0');          // 头
            p.poly([[0.290, 0.170], [0.360, 0.030], [0.430, 0.180]], '#e0d8d0');
            p.poly([[0.570, 0.180], [0.640, 0.030], [0.710, 0.170]], '#e0d8d0');
            p.poly([[0.330, 0.150], [0.365, 0.075], [0.400, 0.160]], '#f5b6c4');
            p.poly([[0.600, 0.160], [0.635, 0.075], [0.670, 0.150]], '#f5b6c4');
            p.circle(0.410, 0.330, 0.038, '#4a3f38');
            p.circle(0.590, 0.330, 0.038, '#4a3f38');
            p.poly([[0.470, 0.410], [0.530, 0.410], [0.500, 0.450]], '#f08fa4');  // 鼻子
            p.circle(0.300, 0.410, 0.042, '#f5b6c4');   // 腮红
            p.circle(0.700, 0.410, 0.042, '#f5b6c4');
            break;
        }
        case ArtType.TV: {
            // 老式小电视：机身 + 亮着的屏幕 + 两只脚
            p.rect(0.24, 0.86, 0.14, 0.13, 4, '#8a6a52');
            p.rect(0.62, 0.86, 0.14, 0.13, 4, '#8a6a52');
            p.rect(0.04, 0.06, 0.92, 0.82, 12, '#7d6a60');
            p.rect(0.10, 0.15, 0.74, 0.64, 8, '#a8dcf2');   // 屏幕
            p.rect(0.14, 0.52, 0.26, 0.20, 6, '#d8f0fc');   // 反光
            p.circle(0.905, 0.28, 0.035, '#f2c489');
            p.circle(0.905, 0.42, 0.035, '#f2c489');
            break;
        }
        case ArtType.FloorLamp: {
            // 落地灯：比台灯高一倍，灯罩在顶上
            p.ellipse(0.50, 0.970, 0.34, 0.026, '#c9a06a');
            p.rect(0.455, 0.20, 0.09, 0.77, 3, '#c9a06a');
            p.poly([[0.06, 0.20], [0.94, 0.20], [0.72, 0.01], [0.28, 0.01]], '#ffd166');
            p.ellipse(0.50, 0.215, 0.30, 0.030, '#fff0b8');
            break;
        }
        case ArtType.Pillow: {
            // 靠垫：圆角主体 + 四角小揪揪，不然缩到 80×40 会像一块肥皂
            p.rect(0.10, 0.08, 0.80, 0.84, 15, '#f2a8b8');
            p.rect(0.16, 0.16, 0.68, 0.68, 12, '#f9c2cd');
            p.rect(0.145, 0.475, 0.71, 0.05, 2, '#e890a6');
            p.circle(0.105, 0.150, 0.055, '#e890a6');
            p.circle(0.895, 0.150, 0.055, '#e890a6');
            p.circle(0.105, 0.850, 0.055, '#e890a6');
            p.circle(0.895, 0.850, 0.055, '#e890a6');
            p.circle(0.50, 0.500, 0.055, '#ffffff');
            break;
        }
        case ArtType.Clock: {
            p.rect(0.455, 0.00, 0.09, 0.12, 3, '#b98a5e');   // 挂绳
            p.circle(0.50, 0.52, 0.44, '#e0b070');           // 外圈
            p.circle(0.50, 0.52, 0.36, '#fffaf2');           // 表盘
            p.rect(0.478, 0.26, 0.044, 0.28, 2, '#8a6a52');  // 时针
            p.rect(0.50, 0.495, 0.20, 0.044, 2, '#8a6a52');  // 分针
            p.circle(0.50, 0.52, 0.045, '#e0b070');
            break;
        }
        case ArtType.Curtain: {
            p.rect(0.02, 0.03, 0.96, 0.06, 3, '#b98a5e');    // 杆
            p.circle(0.03, 0.06, 0.035, '#8f6440');
            p.circle(0.97, 0.06, 0.035, '#8f6440');
            p.rect(0.06, 0.09, 0.34, 0.89, 8, '#f7b8c9');    // 左帘
            p.rect(0.13, 0.12, 0.05, 0.84, 2, '#efa2b7');
            p.rect(0.25, 0.12, 0.05, 0.84, 2, '#efa2b7');
            p.rect(0.60, 0.09, 0.34, 0.89, 8, '#f7b8c9');    // 右帘
            p.rect(0.67, 0.12, 0.05, 0.84, 2, '#efa2b7');
            p.rect(0.79, 0.12, 0.05, 0.84, 2, '#efa2b7');
            break;
        }
        case ArtType.FishTank: {
            p.rect(0.06, 0.86, 0.88, 0.12, 4, '#c9a06a');    // 底座
            p.rect(0.08, 0.10, 0.84, 0.78, 8, '#a8dff0');    // 水
            p.rect(0.13, 0.16, 0.72, 0.66, 6, '#c4ecf8');    // 水体亮面
            p.circle(0.78, 0.30, 0.035, '#ffffff');
            p.circle(0.70, 0.42, 0.026, '#ffffff');
            p.ellipse(0.42, 0.52, 0.13, 0.08, '#f2a05a');    // 鱼身
            p.poly([[0.28, 0.52], [0.20, 0.44], [0.20, 0.60]], '#e08a3c');
            p.circle(0.47, 0.50, 0.018, '#4a3f38');
            p.circle(0.62, 0.72, 0.042, '#8fd9a5');          // 水草
            p.circle(0.70, 0.76, 0.036, '#6fc48a');
            break;
        }
    }
}

/**
 * 《小小布置家》—— 家具外观
 *
 * 挂在物品节点上，选一个 artType，运行时用 Graphics 直接画出来。
 * 不用任何图片：改尺寸改颜色都是改这里的参数，包体一个字节都不涨。
 */
@ccclass('FurnitureArt')
export class FurnitureArt extends Component {
    @property({ type: Enum(ArtType), tooltip: '这件东西长什么样' })
    artType: ArtType = ArtType.Bed;

    onLoad() {
        // 占位用的白色 Sprite 会和画出来的图叠在一起，这里直接关掉
        const sp = this.getComponent(Sprite);
        if (sp) sp.enabled = false;

        this.draw();
    }

    draw() {
        const g = this.getComponent(Graphics) || this.addComponent(Graphics)!;
        const ut = this.getComponent(UITransform)!;
        drawFurniture(g, this.artType, ut.width, ut.height);
    }
}
