class Cancelled(Exception):
    pass


class SecurityFailure(Exception):
    pass


class QuarantineRequired(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class DeliveryFailure(Exception):
    pass
