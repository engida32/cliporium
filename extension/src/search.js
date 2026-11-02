export function normalizeQuery(query) {
    return typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
}

export function matchesQuery(item, query) {
    if (!query)
        return true;
    return [item.text, item.preview, item.mime]
        .filter(value => typeof value === 'string' && value.length > 0)
        .join('\n')
        .toLocaleLowerCase()
        .includes(query);
}
