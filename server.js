require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ============================================================
// MONGODB SCHEMAS
// ============================================================

const commentSchema = new mongoose.Schema({
  userName:   String,
  userAvatar: String,
  userColor:  String,
  text:       String,
  createdAt:  { type: Date, default: Date.now }
});

const postSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  body:       { type: String, required: true },
  tag:        { type: String, enum: ['bull','bear','analysis','strategy','news','qa'], default: 'analysis' },
  tickers:    [String],
  userName:   String,
  userAvatar: String,
  userColor:  String,
  userBadge:  String,
  votes:      { type: Number, default: 0 },
  upvoters:   [String],
  downvoters: [String],
  views:      { type: Number, default: 0 },
  comments:   [commentSchema],
  createdAt:  { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// ============================================================
// REST API ROUTES
// ============================================================

app.get('/api/posts', async (req, res) => {
  try {
    const { tag, sort = 'hot', search = '', limit = 20, skip = 0 } = req.query;

    let query = {};
    if (tag && tag !== 'all') query.tag = tag;
    if (search.trim()) {
      query.$or = [
        { title:   { $regex: search, $options: 'i' } },
        { body:    { $regex: search, $options: 'i' } },
        { tickers: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    let sortObj = {};
    if (sort === 'new')      sortObj = { createdAt: -1 };
    else if (sort === 'top') sortObj = { votes: -1 };
    else                     sortObj = { votes: -1, views: -1 };

    const posts = await Post.find(query)
      .sort(sortObj)
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await Post.countDocuments(query);
    res.json({ posts, total });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const post = new Post(req.body);
    await post.save();
    io.emit('new_post', post);
    res.status(201).json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/posts/:id/vote', async (req, res) => {
  try {
    const { dir, userId } = req.body;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });

    const alreadyUp = post.upvoters.includes(userId);
    const alreadyDn = post.downvoters.includes(userId);

    if (dir === 'up') {
      if (alreadyUp) {
        post.votes--;
        post.upvoters.pull(userId);
      } else {
        if (alreadyDn) { post.votes++; post.downvoters.pull(userId); }
        post.votes++;
        post.upvoters.push(userId);
      }
    } else {
      if (alreadyDn) {
        post.votes++;
        post.downvoters.pull(userId);
      } else {
        if (alreadyUp) { post.votes--; post.upvoters.pull(userId); }
        post.votes--;
        post.downvoters.push(userId);
      }
    }

    await post.save();
    io.emit('vote_update', { postId: post._id, votes: post.votes });
    res.json({ votes: post.votes });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });

    post.comments.push(req.body);
    await post.save();

    const newComment = post.comments[post.comments.length - 1];
    io.emit('new_comment', { postId: post._id, comment: newComment });
    res.status(201).json(newComment);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalPosts = await Post.countDocuments();
    const result = await Post.aggregate([
      { $project: { count: { $size: '$comments' } } },
      { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    res.json({
      posts:    totalPosts,
      comments: result[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SOCKET.IO
// ============================================================

let onlineCount = 0;

io.on('connection', (socket) => {
  onlineCount++;
  io.emit('online_count', onlineCount);
  console.log('User connected   | Online: ' + onlineCount);

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit('online_count', onlineCount);
    console.log('User disconnected | Online: ' + onlineCount);
  });
});

// ============================================================
// START
// ============================================================

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    server.listen(process.env.PORT, () => {
      console.log('Server running at http://localhost:' + process.env.PORT);
      console.log('Forum -> http://localhost:' + process.env.PORT + '/trademonk-forum.html');
      console.log('App   -> http://localhost:' + process.env.PORT + '/trademonk.html');
    });
  })
  .catch(err => {
    console.error('MongoDB connection failed: ' + err.message);
  });