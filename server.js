require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/library_management';

const bookSchema = new mongoose.Schema({
  id: { type: String, default: () => crypto.randomUUID(), unique: true },
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  isbn: { type: String, required: true, trim: true, unique: true },
  year: { type: Number, required: true, min: 1000, max: 2100 }
}, { timestamps: true });

const memberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true }
}, { timestamps: true });

const loanSchema = new mongoose.Schema({
  bookId: { type: String, required: true },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  issueDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  returnedAt: { type: Date, default: null }
}, { timestamps: true });

loanSchema.index(
  { bookId: 1 },
  { unique: true, partialFilterExpression: { returnedAt: null } }
);

const Book = mongoose.model('Book', bookSchema);
const Member = mongoose.model('Member', memberSchema);
const Loan = mongoose.model('Loan', loanSchema);

app.use(express.json());

app.get('/', (_request, response) => {
  response.sendFile(path.join(__dirname, 'aat1.html'));
});

app.get('/api/books', async (_request, response, next) => {
  try {
    const books = await Book.find().sort({ createdAt: -1 }).lean();
    const loans = await Loan.find({
      bookId: { $in: books.map(book => book.id) },
      returnedAt: null
    }).populate('memberId', 'name').lean();
    const loansByBookId = new Map(loans.map(loan => [loan.bookId, loan]));
    const today = new Date().toISOString().slice(0, 10);

    response.json(books.map(book => {
      const loan = loansByBookId.get(book.id);
      const dueDate = loan ? loan.dueDate.toISOString().slice(0, 10) : '';
      return {
        id: book.id,
        title: book.title,
        author: book.author,
        category: book.category,
        isbn: book.isbn,
        year: book.year,
        status: !loan ? 'Available' : dueDate < today ? 'Overdue' : 'Issued',
        issuedTo: loan?.memberId?.name || '',
        issueDate: loan ? loan.issueDate.toISOString().slice(0, 10) : '',
        dueDate
      };
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/api/books', async (request, response, next) => {
  const { title, author, category, isbn, year } = request.body;
  const publishedYear = Number(year);
  if (![title, author, category, isbn].every(value => typeof value === 'string' && value.trim()) ||
      !Number.isInteger(publishedYear) || publishedYear < 1000 || publishedYear > 2100) {
    return response.status(400).json({ error: 'Enter valid book details.' });
  }

  try {
    const book = await Book.create({ title, author, category, isbn, year: publishedYear });
    response.status(201).json({ id: book.id });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({ error: 'A book with this ISBN already exists.' });
    }
    next(error);
  }
});

app.post('/api/books/:id/loans', async (request, response, next) => {
  const memberName = typeof request.body.memberName === 'string'
    ? request.body.memberName.trim()
    : '';
  if (!memberName || memberName.length > 120) {
    return response.status(400).json({ error: 'Enter a member name (up to 120 characters).' });
  }

  try {
    const book = await Book.findOne({ id: request.params.id }).select('id').lean();
    if (!book) return response.status(404).json({ error: 'Book not found.' });

    const nameKey = memberName.toLocaleLowerCase();
    const member = await Member.findOneAndUpdate(
      { nameKey },
      { $setOnInsert: { name: memberName, nameKey } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const issueDate = new Date();
    issueDate.setUTCHours(0, 0, 0, 0);
    const dueDate = new Date(issueDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + 14);
    await Loan.create({ bookId: book.id, memberId: member._id, issueDate, dueDate });
    response.status(201).json({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({ error: 'This book is already issued.' });
    }
    next(error);
  }
});

app.post('/api/books/:id/return', async (request, response, next) => {
  try {
    const loan = await Loan.findOneAndUpdate(
      { bookId: request.params.id, returnedAt: null },
      { $set: { returnedAt: new Date() } },
      { new: true }
    );
    if (!loan) return response.status(404).json({ error: 'No active loan found for this book.' });
    response.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'A server error occurred.' });
});

async function start() {
  await mongoose.connect(mongoUri);
  app.listen(port, () => {
    console.log(`Library app running at http://localhost:${port}`);
  });
}

start().catch(error => {
  console.error('Could not connect to MongoDB. Check MONGODB_URI and make sure MongoDB is running.', error.message);
  process.exit(1);
});
