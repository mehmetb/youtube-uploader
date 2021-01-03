interface playlist {
  name: string,
  create?: boolean,
}

interface video {
  path: string,
  title: string,
  description: string,
  tags?: string[],
  language?: string,
  playlist?: playlist,
}

export { playlist, video };
