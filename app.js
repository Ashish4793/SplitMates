//jshint esversion:6
require('dotenv').config();

const express = require('express');
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require('connect-mongo')(session);
const passport = require("passport");
const bodyParser = require('body-parser');
const ejs = require("ejs");
var findOrCreate = require('mongoose-findorcreate')
var GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();

passport.serializeUser(function (user, done) {
  done(null, user);
});
passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

app.set('view engine', 'ejs');
const path = require('path')

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: {
    expires: 30 * 24 * 60 * 60
},
store: new MongoStore({ mongooseConnection: mongoose.connection })
}));

app.use(passport.initialize());
app.use(passport.session());

mongoose.set("strictQuery", false);
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);

    } catch (error) {
        console.log(error);
        process.exit(1);
    }
};

const userSchema = new mongoose.Schema({
  userID : {type : String , required : true , unique : true},
  name : {type : String, required : true},
  email : {type : String , required : true , unique : true},
});

userSchema.plugin(findOrCreate);

const groupSchema = new mongoose.Schema({
  groupName : {type : String , required : true },
  members : [{
    memberID : {type : String , unique : true},
    memberName : String,
  }],
});

const expenseSchema = new mongoose.Schema({
  groupID : {type : String , required : true},
  expenseName : {type : String , required : true},
  expenseTotalAmount : {type : Number , required : true},
  splitByNum : {type : Number , required : true},
  eachShare : {type : Number , required : true},
  splitTo : {type : String , required : true},
  paymentMethod : {type : String , enum : ['UPI' , 'CARD' , 'CASH' , 'NA'] , required : true},
  addedByID : {type : String , required : true},
  addedByName : {type : String , required : true},
  paid_status : [{
    memberID : {type : String , required : true},
    status : {type : String , default : "not paid"}
  }]
});

const User = mongoose.model("User" , userSchema);
const Group = mongoose.model("Group" , groupSchema);
const Expense = mongoose.model("Expense" , expenseSchema);


passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
},
function(accessToken, refreshToken, profile, cb) {
  User.findOrCreate({ userID: profile.id , name : profile.displayName , email: profile.emails[0].value }, function (err, user) {
    return cb(err, user);
  });
}
));


app.get('/auth/google',
    passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'], prompt: 'select_account' }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/auth/login' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
});

app.get('/auth/login' , (req,res) => {
  if (req.isAuthenticated()){
    res.redirect("/")
  } else {
    res.render("login")
  }
});

app.get('/groups' , (req,res) =>{
  if (req.isAuthenticated()){
    if (req.user.userID === process.env.SUPER_USER){
      Group.findOne({} , function(err , foundGroups){
        if (!err) {
          res.render("groups" , {groups : foundGroups});
        } else {
          console.log(err);
        }
      });
    } else {
      res.redirect('/');
    }
    } else {
      res.redirect('/');
  }
})

app.get('/account' , (req,res) =>{
   if(req.isAuthenticated()){
    res.render("account" , {user : req.user});
   } else {
    res.redirect('/');
   }
});


app.get('/join-group' , (req,res)=>{
  if(req.isAuthenticated()){
    Group.findOne({_id : req.query.groupID} , (err , foundGroup) => {
      if (!err){
        if (foundGroup != null) {
          res.render("join-group" , {foundGroup : foundGroup , error : false})
        } else {
          res.render("join-group" , {foundGroup : null , error : true})
        }
      } else {
        console.log(err);
      }
    })
  } else {
    res.redirect("/");
  }
});

app.post('/join-group' , function(req,res){
  if(req.isAuthenticated()){
    const newMember = {
      memberID: req.user._id,
      memberName: req.user.name
    };
    Group.findById(req.body.groupID, (err, group) => {
      if (err) {
        console.error(err);
      } else {
        group.members.push(newMember);
    
        group.save((err, updatedGroup) => {
          if (err) {
            console.error(err);
          } else {
            res.redirect('/');
            // console.log('New member added to the group:', updatedGroup);
          }
        });
      }
    });
  } else {
    res.redirect('/')
  }
})

app.get("/" , function(req,res){
  if (req.isAuthenticated()){
    Group.findOne({'members.memberID' : req.user._id} , function(err , foundGroup){
      if (!err) {
        if (foundGroup != null) {
          Expense.find({groupID : foundGroup._id , "paid_status.memberID": req.user._id,
        } , function(err , foundExpenses){
            if (!err) {
              const paidExpenses = foundExpenses.filter(document => {
                const PaidStatus = document.paid_status.some(statusObj => 
                  statusObj.memberID === req.user._id && statusObj.status === 'paid'
                );
              
                return PaidStatus;
              });

              const UnPaidExpenses = foundExpenses.filter(document => {
                const hasNotPaidStatus = document.paid_status.some(statusObj => 
                  statusObj.memberID === req.user._id && statusObj.status !== 'paid'
                );
              
                return hasNotPaidStatus;
              });
              res.render("home" , {Expenses : UnPaidExpenses, PaidExpenses : paidExpenses , groupID : foundGroup._id , groupName : foundGroup.groupName});
            } else {
              console.log(err);
            }
          });
        } else {
          res.redirect("/create-group")
        }
      } else {
        console.log(err);
      }
    });
  } else {
    res.render("info");
  }
});

app.get("/create-group" , function(req,res){
  if (req.isAuthenticated()){
    res.render("create-group");
  } else {
    res.redirect("/");
  }
});

app.post('/create-group' , function(req,res){
  if (req.isAuthenticated()){
    if (req.user.userID === process.env.SUPER_USER){
      const newGroup = new Group({
        groupName : req.body.name,
        members : {
          memberID : req.user._id,
          memberName : req.user.name
        }
      });
      newGroup.save(function(err){
        if (!err) {
          // console.log("Added");
          res.redirect("/");
        } else {
          console.log(err);
        }
      });
    } else {
      res.redirect("/create-group");
    }
  } else {
    res.redirect("/");
  }
});



app.get("/add-expense" , (req,res) => {
  if (req.isAuthenticated()){
    Group.findOne({ 'members.memberID' : req.user._id} , function(err , foundGroup){
      if (!err) {
        res.render("add-expense" , {foundGroup : foundGroup , groupID : req.query.groupID , userID : req.user._id})
      } else {
        console.log(err);
      }
    });
  } else {
    res.render("home")
  }
});

app.post("/add-expense" , (req,res) => {
  if (req.isAuthenticated()){
    Group.findOne({_id : req.body.groupID } , function(err , foundGroup){
      if (!err) {
        if (req.body.splitTo === "All"){
          const memberIDs = foundGroup.members.map(member => member.memberID).filter(memberID => memberID !== req.user._id);
          const newExpense = new Expense({
            groupID : req.body.groupID,
            expenseName : req.body.expenseName,
            expenseTotalAmount : req.body.expenseAmount,
            splitByNum : 1 + memberIDs.length,
            eachShare : Math.round(req.body.expenseAmount / (1 + memberIDs.length)),
            splitTo : req.body.splitTo,
            paymentMethod : req.body.paymentMethod,
            addedByID : req.user._id,
            addedByName : req.user.name,
            paid_status : [
              {
              memberID : memberIDs[0],
              },
              {
                memberID : memberIDs[1],
              }    
          ]
          });
          newExpense.save((err) => {
            if (!err) {
              res.redirect(`/my-expenses?groupID=${req.body.groupID}`);
            } else {
              console.log(err);
            }
          });
        } else {
          const newExpense = new Expense({
            groupID : req.body.groupID,
            expenseName : req.body.expenseName,
            expenseTotalAmount : req.body.expenseAmount,
            splitByNum : 2,
            eachShare : Math.round(req.body.expenseAmount / 2),
            splitTo : req.body.mySelectText,
            paymentMethod : req.body.paymentMethod,
            addedByID : req.user._id,
            addedByName : req.user.name,
            paid_status : [
              {
              memberID : req.body.splitTo,
              },   
          ]
          });
          newExpense.save((err) => {
            if (!err) {
              res.redirect(`/my-expenses?groupID=${req.body.groupID}`);
            } else {
              console.log(err);
            }
          });
        }
        
      } else {
        console.log(err);
      }
    })
    
  }
});

app.post("/settle-expense" , function(req,res){
  if (req.isAuthenticated()){
    Expense.updateOne(
      { _id: req.body.expenseID, 'paid_status.memberID': req.user._id },
      { $set: { 'paid_status.$.status': 'paid' } },
      (err, result) => {
        if (err) {
          console.error('Error:', err);
          return;
        }
        res.redirect('/');
      }
    );
  } else {
    res.redirect('/')
  }
});

app.post('/delete-expense' , function(req,res){
  if (req.isAuthenticated()){
    Expense.deleteOne({_id : req.body.expenseID , addedByID : req.user._id} , function(err){
      if (!err) {
        res.redirect(`/my-expenses?groupID=${req.body.groupID}`);
      } else {
        console.log(err);
      }
    });
  } else {
    res.redirect("/");
  }
});

app.get("/my-expenses" , (req,res) => {
  if (req.isAuthenticated()){
    Expense.find({groupID : req.query.groupID , addedByID : req.user._id} , function(err , foundExpenses){
      if (!err) {
        const documentsWithAllPaidStatus = foundExpenses.filter(document => {
          return document.paid_status.every(statusObj => statusObj.status === 'paid');
        });
        const documentsWithAtLeastOneNotPaid = foundExpenses.filter(document => {
          return document.paid_status.some(statusObj => statusObj.status !== 'paid');
        });
        res.render("my-expenses" , {unPaidExpenses : documentsWithAtLeastOneNotPaid, paidExpenses : documentsWithAllPaidStatus});
      } else {
        console.log(err);
      }
    });
  } else {
    res.redirect('/')
  }
});

app.get("/logout" , (req,res) => {
  if (req.isAuthenticated()){
    req.logout(() => {});
    res.redirect("/")
  } else {
    res.redirect('/auth/login')
  }
});



connectDB().then(() => {
  console.log("splitmatesDB CONNECTED SUCCESFULLY");
  app.listen(process.env.PORT || 3000, () => {
      console.log("SplitMates Server STARTED");
  });
});
