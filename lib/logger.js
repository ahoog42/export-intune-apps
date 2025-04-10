const { createLogger, format, transports } = require("winston");
const { combine, timestamp, json, errors, splat, colorize, simple } = format;

let loggerOptions = {
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { service: "app" },
  format: combine(timestamp(), errors({ stack: true }), splat(), json()),
  transports: [new transports.Console()],
};

// if in development mode, don't use json format
const env = process.env.NODE_ENV || "development";
if (env === "development") {
  loggerOptions = {
    level: process.env.LOG_LEVEL || "info",
    format: combine(errors({ stack: true }), splat(), colorize(), simple()),
    transports: [new transports.Console()],
  };
}

const logger = createLogger(loggerOptions);

module.exports = logger;
