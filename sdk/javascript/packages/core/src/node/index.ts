import {nodePlatform} from "./nodePlatform"
import {connectPlatform} from "../platform"
import {initialize} from '../keeper'

connectPlatform(nodePlatform)
initialize()

export * from '../keeper'

