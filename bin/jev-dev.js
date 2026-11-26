#!/usr/bin/env node

import { createCli } from "../dist/cli/index.js";

createCli().parse(process.argv);
