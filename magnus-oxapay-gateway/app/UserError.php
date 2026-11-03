<?php

declare(strict_types=1);

namespace Gateway;

/**
 * An error whose message is safe to show to the customer (bad input, unknown account, ...).
 */
final class UserError extends \RuntimeException
{
    /** @var string */
    public $errorCode;

    /** @var int */
    public $httpStatus;

    public function __construct(string $errorCode, string $message, int $httpStatus = 400)
    {
        parent::__construct($message);
        $this->errorCode = $errorCode;
        $this->httpStatus = $httpStatus;
    }
}
