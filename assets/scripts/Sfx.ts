import { AudioClip, AudioSource, director, game, Game, Node, resources } from 'cc';

/**
 * 极简音效管理器
 *
 * 音频放在 assets/resources/audio/ 下，文件名就是 key（click / pop / place / del / nope / win）。
 * 用 6 个 AudioSource 轮流播放，避免同一个音效连续触发时被自己掐断。
 *
 * 为什么用真文件而不是 WebAudio 现场合成：安卓原生包里没有 document，
 * 现场合成那套只在学校浏览器里能用，打包到手机上会一声不响。
 */
export class Sfx {
    private static _inited = false;
    private static _pool: AudioSource[] = [];
    private static _clips: Record<string, AudioClip> = {};
    private static _rr = 0;
    private static _muted = false;

    private static _bgm: AudioSource | null = null;
    private static _wantBgm = false;
    private static _bgmVolume = 0.3;
    private static _bgmPaused = false;

    static init() {
        if (this._inited) return;
        const scene = director.getScene();
        if (!scene) return;          // 场景还没起来，下次再试
        this._inited = true;

        const n = new Node('sfx');
        n.parent = scene;
        for (let i = 0; i < 6; i++) {
            const s = n.addComponent(AudioSource);
            s.playOnAwake = false;
            this._pool.push(s);
        }

        // 背景音乐单独一路，不跟音效抢播放器
        const bgm = n.addComponent(AudioSource);
        bgm.playOnAwake = false;
        bgm.loop = true;
        this._bgm = bgm;

        resources.loadDir('audio', AudioClip, (err, clips) => {
            if (err) { console.warn('[Sfx] 音效加载失败', err); return; }
            for (const c of clips) this._clips[c.name] = c;
            if (this._wantBgm) this.startBgm();     // 音乐比音效大，加载完再补上
        });

        // 切到后台就停，回来接着放（不然微信/电话响的时候背景里还在唱）
        game.on(Game.EVENT_HIDE, () => {
            if (this._bgm && this._bgm.playing) { this._bgm.pause(); this._bgmPaused = true; }
        });
        game.on(Game.EVENT_SHOW, () => {
            if (this._bgmPaused && this._bgm && !this._muted) { this._bgm.play(); }
            this._bgmPaused = false;
        });
    }

    static play(name: string, volume = 0.85) {
        if (this._muted) return;
        const clip = this._clips[name];
        if (!clip || !this._pool.length) return;
        const s = this._pool[this._rr++ % this._pool.length];
        s.playOneShot(clip, volume);
    }

    /** 循环背景音乐：音量压得比音效低一截，别盖过"咚"的一声 */
    static playBgm(volume = 0.3) {
        this._wantBgm = true;
        this._bgmVolume = volume;
        this.startBgm();
    }

    static stopBgm() {
        this._wantBgm = false;
        if (this._bgm) this._bgm.stop();
    }

    private static startBgm() {
        if (this._muted || !this._bgm) return;
        const clip = this._clips['bgm'];
        if (!clip || this._bgm.playing) return;
        this._bgm.clip = clip;
        this._bgm.loop = true;
        this._bgm.volume = this._bgmVolume;
        this._bgm.play();
    }

    /** 给设置里加个"关掉声音"用 */
    static setMuted(v: boolean) {
        this._muted = v;
        if (!this._bgm) return;
        if (v) this._bgm.pause();
        else if (this._wantBgm) this.startBgm();
    }
    static get muted() { return this._muted; }
}
