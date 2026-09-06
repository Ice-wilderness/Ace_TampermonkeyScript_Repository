// 仅使用合成数据；固定时间使测试不依赖真实视频或运行日期。
export const epoch = Date.UTC(2026, 8, 6, 0);
export const key = (n, page = 1) => `BV${String(n).padStart(10, '0')}${page > 1 ? `?p=${page}` : ''}`;
export const record = (percent = 50, time = epoch, title = '合成测试视频') => ({
    v: 3, status: '已观看', currentTime: '05:00', percent: `${percent}%`,
    savedAt: new Date(time).toISOString(), title
});
export function records(count) {
    return Object.fromEntries(Array.from({ length: count }, (_, i) => [key(i + 1), record(i % 101, epoch - (i % 100) * 86400000, `合成视频 ${i + 1}`)]));
}
export const legacy = () => ({
    [key(1)]: ['已观看', '05:00', '50%', '2026-09-05 12:00:00', '旧数组'],
    [key(1, 2)]: { ...record(), v: 2 },
    [key(1, 3)]: { s: 1, t: '05:00', p: 50, a: epoch / 1000, n: '紧凑格式' }
});
export const invalidImports = () => [
    { [key(1)]: record(), [key(2)]: null },
    { invalid: record() },
    { [key(1)]: { ...record(), percent: 'NaN%' } },
    { [key(1)]: { ...record(), savedAt: '不是日期' } },
    { [key(1)]: record(), [`${key(1)}?p=1`]: record() }
];
