export function normalizeQuery(query) {
    return typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
}

export function matchesQuery(item, query) {
    if (!query)
        return true;
    return item.text.toLocaleLowerCase().includes(query);
}
