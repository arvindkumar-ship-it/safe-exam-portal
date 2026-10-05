from fastapi import Query


class PageParams:
    def __init__(self, page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100)):
        self.page, self.page_size = page, pageSize

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_out(items: list, page: int, page_size: int, total: int) -> dict:
    return {"items": items, "page": page, "pageSize": page_size, "total": total}
