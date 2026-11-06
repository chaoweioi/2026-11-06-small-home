import { ArtType, ITEMS } from './FurnitureArt';

/** 一个目标：要摆几件什么东西 */
export interface Goal {
    type: ArtType;
    count: number;
}

/** 一关的全部数据 —— 以后加关卡只改这个文件 */
export interface LevelConfig {
    name: string;
    /** 开局那两秒给玩家看的一句话。固定关必须写；随机关不写，会按件数自动生成 */
    intro?: string;
    /** 固定目标：手写好的清单。写了就用它，goalPool 会被忽略 */
    goals?: Goal[];
    /** 随机目标：从这些里面挑 */
    goalPool?: ArtType[];
    /** 随机目标挑几件 */
    goalCount?: number;
    /** 本关新解锁的东西，随机时优先被选中 */
    featured?: ArtType;
    /** 房间配色序号，见 RoomArt.ROOM_THEMES（0 卧室 / 1 客厅 / 2 儿童房 / 3 书房） */
    room?: number;
    available: ArtType[];   // 抽屉里给哪些东西
}

// ---------- 随机关的目标生成 ----------

/** 线性同余，够用即可；同一个种子一定得到同一组目标 */
function makeRng(seed: number) {
    // 先和常量异或再空转几轮：不然小种子算出来的第一个数总是落在同一段区间，
    // "本关新东西 70% 优先"会退化成"每次都选它"
    let s = ((seed >>> 0) ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < 4; i++) s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** 占地 >= 3x3 格（格子 40）算大件 */
const isBig = (t: ArtType) => {
    const s = ITEMS[t];
    return s.w * s.h >= 120 * 120;
};
/** 占地 <= 2x2 格算小件 */
const isSmall = (t: ArtType) => {
    const s = ITEMS[t];
    return s.w * s.h <= 80 * 80;
};

/**
 * 按种子从池子里挑目标。规则（都是为了避免 6-8 岁看不懂的随机）：
 *   1. 不重复 —— 同一件最多一次，不会有"挂画 x2"这种歧义
 *   2. 本关新东西 70% 优先
 *   3. 至少一件大件、一件小件 —— 房间既放得下，也不会全是小的显空
 *   4. 件数固定，不会这一关 2 件下一关 6 件
 */
export function pickGoals(lv: LevelConfig, seed: number): Goal[] {
    if (lv.goals && lv.goals.length) return lv.goals;

    const pool = (lv.goalPool && lv.goalPool.length ? lv.goalPool : lv.available).slice();
    const want = Math.max(1, Math.min(lv.goalCount || 3, pool.length));
    const rnd = makeRng(seed);
    const chosen: ArtType[] = [];

    const take = (t: ArtType | undefined) => {
        if (t === undefined) return;
        if (chosen.indexOf(t) < 0 && chosen.length < want) chosen.push(t);
    };

    // 1. 本关新解锁的优先
    if (lv.featured !== undefined && pool.indexOf(lv.featured) >= 0 && rnd() < 0.7) take(lv.featured);

    // 2. 大小各保底一件
    if (want >= 2) {
        const bigs = pool.filter((t) => isBig(t) && chosen.indexOf(t) < 0);
        const smalls = pool.filter((t) => isSmall(t) && chosen.indexOf(t) < 0);
        if (!chosen.some(isBig) && bigs.length) take(bigs[Math.floor(rnd() * bigs.length)]);
        if (!chosen.some(isSmall) && smalls.length) take(smalls[Math.floor(rnd() * smalls.length)]);
    }

    // 3. 剩下的随机补满
    const rest = pool.filter((t) => chosen.indexOf(t) < 0);
    while (chosen.length < want && rest.length) {
        take(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
    }

    return chosen.map((t) => ({ type: t, count: 1 }));
}

/** 随机关的提示语：固定关用自己写的，随机关按件数拼一句 */
export function introOf(lv: LevelConfig, goals: Goal[]): string {
    if (lv.intro) return lv.intro;
    return `挑 ${goals.length} 件，把房间布置好吧`;
}

export const LEVELS: LevelConfig[] = [
    {
        name: '我的小卧室',
        room: 0,
        intro: '把小床、台灯和绿植都放进来吧',
        goals: [
            { type: ArtType.Bed, count: 1 },
            { type: ArtType.Lamp, count: 1 },
            { type: ArtType.Plant, count: 1 },
        ],
        available: [ArtType.Bed, ArtType.Lamp, ArtType.Plant, ArtType.Rug, ArtType.Cabinet],
    },
    {
        name: '小熊的角落',
        room: 0,
        intro: '给小熊布置一个舒服的角落',
        goals: [
            { type: ArtType.Rug, count: 1 },
            { type: ArtType.Cabinet, count: 1 },
            { type: ArtType.Stool, count: 1 },
            { type: ArtType.Bear, count: 1 },
        ],
        available: [ArtType.Rug, ArtType.Cabinet, ArtType.Stool, ArtType.Bear, ArtType.Plant, ArtType.Lamp,
                    ArtType.Sofa, ArtType.ToyBox, ArtType.TV, ArtType.Pillow],
    },
    // ---- 下面三关开始随机 ----
    {
        name: '温暖的客厅',
        room: 1,
        intro: '客厅还空着，挑几件东西摆上吧',
        goalPool: [ArtType.Bed, ArtType.Cabinet, ArtType.Lamp, ArtType.Rug, ArtType.Plant,
                   ArtType.Poster, ArtType.Stool, ArtType.Bear, ArtType.Sofa, ArtType.ToyBox,
                   ArtType.TV, ArtType.Pillow],
        goalCount: 3,
        featured: ArtType.Sofa,
        available: [ArtType.Bed, ArtType.Cabinet, ArtType.Lamp, ArtType.Rug, ArtType.Plant,
                    ArtType.Poster, ArtType.Stool, ArtType.Bear, ArtType.Sofa, ArtType.ToyBox,
                    ArtType.TV, ArtType.Pillow, ArtType.Cat, ArtType.Shelf],
    },
    {
        name: '小朋友的房间',
        room: 2,
        intro: '这是一间新的房间，你来决定放什么',
        goalPool: [ArtType.Bed, ArtType.Cabinet, ArtType.Lamp, ArtType.Rug, ArtType.Plant,
                   ArtType.Poster, ArtType.Stool, ArtType.Bear, ArtType.Sofa, ArtType.Shelf,
                   ArtType.ToyBox, ArtType.Cat, ArtType.TV, ArtType.FloorLamp, ArtType.Pillow,
                   ArtType.Clock],
        goalCount: 4,
        featured: ArtType.Shelf,
        available: [ArtType.Bed, ArtType.Cabinet, ArtType.Lamp, ArtType.Rug, ArtType.Plant,
                    ArtType.Poster, ArtType.Stool, ArtType.Bear, ArtType.Sofa, ArtType.Shelf,
                    ArtType.ToyBox, ArtType.Cat, ArtType.TV, ArtType.FloorLamp, ArtType.Pillow,
                    ArtType.Clock, ArtType.Curtain, ArtType.FishTank],
    },
    {
        name: '整间屋子都归你',
        room: 0,
        goalPool: [ArtType.Bed, ArtType.Cabinet, ArtType.Lamp, ArtType.Rug, ArtType.Plant,
                   ArtType.Poster, ArtType.Stool, ArtType.Bear, ArtType.Sofa, ArtType.Shelf,
                   ArtType.ToyBox, ArtType.Cat, ArtType.TV, ArtType.FloorLamp, ArtType.Pillow,
                   ArtType.Clock, ArtType.Curtain, ArtType.FishTank],
        goalCount: 5,
        featured: ArtType.FishTank,
        available: [ArtType.Bed, ArtType.Cabinet, ArtType.Lamp, ArtType.Rug,
                    ArtType.Plant, ArtType.Poster, ArtType.Stool, ArtType.Bear,
                    ArtType.Sofa, ArtType.Shelf, ArtType.ToyBox, ArtType.Cat,
                    ArtType.TV, ArtType.FloorLamp, ArtType.Pillow, ArtType.Clock,
                    ArtType.Curtain, ArtType.FishTank],
    },
];
