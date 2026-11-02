import {formatBytes, imageMimeLabel} from './image-utils.js';

const SHELL_COMMANDS = new Set([
    'sudo', 'apt', 'apt-get', 'dnf', 'pacman', 'systemctl', 'git', 'npm',
    'pnpm', 'yarn', 'docker', 'podman', 'kubectl', 'ssh', 'scp', 'rsync',
    'cd', 'ls', 'grep', 'rg', 'find', 'curl', 'wget', 'make', 'cargo',
    'python', 'python3', 'node',
]);

const CODE_PATTERN = /^(?:#!\/|#include\b|(?:async\s+)?(?:function|const|let|var|class|import|export|def|return)\b|(?:if|for|while|switch|catch)\s*\()/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^(?:https?:\/\/|www\.)/i;

function firstLine(text) {
    if (typeof text !== 'string')
        return '';
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim().replace(/\s+/g, ' ');
        if (trimmed.length > 0)
            return trimmed;
    }
    return '';
}

function plural(value, singular, pluralForm = `${singular}s`) {
    return `${value} ${value === 1 ? singular : pluralForm}`;
}

export function formatRelativeTime(createdAt, now = Date.now()) {
    const timestamp = Number(createdAt);
    if (!Number.isFinite(timestamp) || timestamp <= 0)
        return 'Unknown time';

    const elapsed = Math.max(0, now - timestamp);
    const seconds = Math.floor(elapsed / 1000);
    if (seconds < 45)
        return 'Just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${plural(minutes, 'min')} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${plural(hours, 'hr')} ago`;

    const days = Math.floor(hours / 24);
    if (days < 7)
        return `${plural(days, 'day')} ago`;

    const date = new Date(timestamp);
    const options = {month: 'short', day: 'numeric'};
    if (date.getFullYear() !== new Date(now).getFullYear())
        options.year = 'numeric';
    return date.toLocaleDateString(undefined, options);
}

export function iconForText(text) {
    const line = firstLine(text);
    if (URL_PATTERN.test(line))
        return 'web-browser-symbolic';
    if (EMAIL_PATTERN.test(line))
        return 'mail-unread-symbolic';

    const command = line.split(/\s+/)[0]?.replace(/^sudo$/, '');
    const words = line.split(/\s+/);
    const firstCommand = SHELL_COMMANDS.has(command)
        ? command
        : words[0] === 'sudo' && SHELL_COMMANDS.has(words[1])
            ? words[1]
            : '';
    if (firstCommand)
        return 'utilities-terminal-symbolic';

    if (CODE_PATTERN.test(line) || line.includes('=>') || /[{};]$/.test(line))
        return 'applications-development-symbolic';

    return 'text-x-generic-symbolic';
}

export function iconForItem(item) {
    if (item?.kind === 'image')
        return 'image-x-generic-symbolic';
    return iconForText(item?.text ?? '');
}

export function titleForItem(item) {
    if (item?.kind === 'image')
        return item.preview || 'Image';
    const text = item?.preview || item?.text || '';
    return firstLine(text) || 'Empty clip';
}

export function prettyAppName(sourceApp) {
    if (typeof sourceApp !== 'string' || sourceApp.length === 0)
        return '';
    const withoutDesktop = sourceApp.endsWith('.desktop')
        ? sourceApp.slice(0, -'.desktop'.length)
        : sourceApp;
    const parts = withoutDesktop.split('.').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : '';
}

export function metaForItem(item, now = Date.now()) {
    const parts = [];
    if (item?.kind === 'image') {
        parts.push(imageMimeLabel(item.mime));
        if (item.width > 0 && item.height > 0)
            parts.push(`${item.width} × ${item.height}`);
        if (item.byte_size > 0)
            parts.push(formatBytes(item.byte_size));
    }
    parts.push(formatRelativeTime(item?.created_at, now));
    const app = prettyAppName(item?.source_app);
    if (app)
        parts.push(app);
    if (item?.pinned)
        parts.push('Pinned');
    return parts.join(' · ');
}
